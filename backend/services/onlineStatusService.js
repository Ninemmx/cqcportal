import redisClient from '../config/redis.js';
import pool from '../config/db.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const ONLINE_USERS_KEY = 'online_users';
const USER_STATUS_PREFIX = 'user_status:';
const HEARTBEAT_INTERVAL = 5 * 60; // 5 นาทีในวินาที

class OnlineStatusService {
  // เพิ่มผู้ใช้เข้าสู่ระบบออนไลน์
  async addUserOnline(user_id, userInfo = {}) {
    try {
      const userKey = `${USER_STATUS_PREFIX}${user_id}`;
      const statusData = {
        user_id,
        name: userInfo.name || '',
        email: userInfo.email || '',
        last_seen: new Date().toISOString(),
        is_active: true
      };

      // เพิ่มผู้ใช้เข้า Redis set และตั้งค่า TTL
      await redisClient.sAdd(ONLINE_USERS_KEY, user_id.toString());
      await redisClient.setEx(userKey, HEARTBEAT_INTERVAL, JSON.stringify(statusData));
      
      console.log(`User ${user_id} added to online users`);
      return true;
    } catch (error) {
      console.error('Error adding user to online status:', error);
      return false;
    }
  }

  // อัพเดท heartbeat ของผู้ใช้
  async updateUserHeartbeat(user_id) {
    try {
      const userKey = `${USER_STATUS_PREFIX}${user_id}`;
      const existingData = await redisClient.get(userKey);
      
      if (existingData) {
        const statusData = JSON.parse(existingData);
        statusData.last_seen = new Date().toISOString();
        statusData.is_active = true;
        
        // อัพเดทข้อมูลและต่อ TTL
        await redisClient.setEx(userKey, HEARTBEAT_INTERVAL, JSON.stringify(statusData));
        return true;
      } else {
        // ถ้าไม่มีข้อมูล ให้ดึงจากฐานข้อมูลและสร้างใหม่
        return await this.addUserFromDatabase(user_id);
      }
    } catch (error) {
      console.error('Error updating user heartbeat:', error);
      return false;
    }
  }

  // ดึงข้อมูลผู้ใช้จากฐานข้อมูลและเพิ่มเข้าระบบออนไลน์
  async addUserFromDatabase(user_id) {
    try {
      const [rows] = await pool.query(
        `SELECT user_id, email, prefix, first_name, last_name 
         FROM member WHERE user_id = ?`,
        [user_id]
      );

      if (rows.length > 0) {
        const user = rows[0];
        const name = user.prefix || user.first_name || user.last_name
          ? `${user.prefix ?? ''}${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
          : user.email;

        return await this.addUserOnline(user_id, {
          name,
          email: user.email
        });
      }
      return false;
    } catch (error) {
      console.error('Error adding user from database:', error);
      return false;
    }
  }

  // ลบผู้ใช้ออกจากระบบออนไลน์
  async removeUserOnline(user_id) {
    try {
      const userKey = `${USER_STATUS_PREFIX}${user_id}`;
      
      // ลบจาก set และลบข้อมูลผู้ใช้
      await redisClient.sRem(ONLINE_USERS_KEY, user_id.toString());
      await redisClient.del(userKey);
      
      console.log(`User ${user_id} removed from online users`);
      return true;
    } catch (error) {
      console.error('Error removing user from online status:', error);
      return false;
    }
  }

  // ดึงรายชื่อผู้ใช้ออนไลน์ทั้งหมด
  async getOnlineUsers() {
    try {
      const onlineUserIds = await redisClient.sMembers(ONLINE_USERS_KEY);
      const users = [];

      for (const userId of onlineUserIds) {
        const userKey = `${USER_STATUS_PREFIX}${userId}`;
        const userData = await redisClient.get(userKey);
        
        if (userData) {
          const statusData = JSON.parse(userData);
          users.push({
            user_id: parseInt(userId),
            name: statusData.name,
            email: statusData.email,
            last_seen: statusData.last_seen,
            is_active: statusData.is_active
          });
        } else {
          // ถ้าไม่มีข้อมูล ให้ลบออกจาก set
          await redisClient.sRem(ONLINE_USERS_KEY, userId);
        }
      }

      return users;
    } catch (error) {
      console.error('Error getting online users:', error);
      return [];
    }
  }

  // ตรวจสอบว่าผู้ใช้ออนไลน์อยู่หรือไม่
  async isUserOnline(user_id) {
    try {
      const userKey = `${USER_STATUS_PREFIX}${user_id}`;
      const userData = await redisClient.get(userKey);
      return userData !== null;
    } catch (error) {
      console.error('Error checking if user is online:', error);
      return false;
    }
  }

  // ทำความสะอาดข้อมูลผู้ใช้ที่หมดอายุ
  async cleanupExpiredUsers() {
    try {
      const onlineUserIds = await redisClient.sMembers(ONLINE_USERS_KEY);
      let cleanedCount = 0;

      for (const userId of onlineUserIds) {
        const userKey = `${USER_STATUS_PREFIX}${userId}`;
        const exists = await redisClient.exists(userKey);
        
        if (!exists) {
          await redisClient.sRem(ONLINE_USERS_KEY, userId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`Cleaned up ${cleanedCount} expired online users`);
      }
      
      return cleanedCount;
    } catch (error) {
      console.error('Error during cleanup:', error);
      return 0;
    }
  }

  // อัพเดทสถานะ active/inactive ของผู้ใช้
  async updateUserActivity(user_id, isActive) {
    try {
      const userKey = `${USER_STATUS_PREFIX}${user_id}`;
      const existingData = await redisClient.get(userKey);
      
      if (existingData) {
        const statusData = JSON.parse(existingData);
        statusData.is_active = isActive;
        statusData.last_seen = new Date().toISOString();
        
        await redisClient.setEx(userKey, HEARTBEAT_INTERVAL, JSON.stringify(statusData));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error updating user activity:', error);
      return false;
    }
  }
}

export default new OnlineStatusService();