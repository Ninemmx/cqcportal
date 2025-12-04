import express from 'express';
import bcrypt from 'bcrypt';
import pool from '../config/db.js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import redisClient from '../config/redis.js';

dotenv.config();
const router = express.Router();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const otpExpirySeconds = 5 * 60; // OTP หมดอายุ 10 นาที

router.post('/', async (req, res) => {
  const { email, student_id, prefix, first_name, last_name, password } = req.body;

  try {
    const [existingUsers] = await pool.query('SELECT * FROM member WHERE student_id = ?', [student_id]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ message: 'มีผู้ใช้งานนี้อยู่แล้ว' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO member 
       (email, student_id, prefix, first_name, last_name, password, perm_id,is_verified)
       VALUES (?, ?, ?, ?, ?, ?, 4,0)`,
      [email, student_id, prefix, first_name, last_name, hashedPassword]
    );

    

    res.status(201).json({ message: 'ลงทะเบียนสำเร็จ ' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการลงทะเบียน' });
  }
});
router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ message: 'ข้อมูลไม่ครบ' });

  const key = `otp:${email.trim().toLowerCase()}`;
  const attemptsKey = `otp_attempts:${email.trim().toLowerCase()}`;
  try {
    const attempts = parseInt(await redisClient.get(attemptsKey) || '0', 10);
    if (attempts >= 5) {
      return res.status(429).json({ message: 'พยายามยืนยันรหัสเกินจำนวนที่อนุญาต กรุณาขอรหัสใหม่' });
    }

    const storedOtp = await redisClient.get(key);
    if (!storedOtp || storedOtp !== otp) {
      await redisClient.incr(attemptsKey);
      await redisClient.expire(attemptsKey, otpExpirySeconds);
      return res.status(400).json({ message: 'รหัส OTP ไม่ถูกต้องหรือหมดอายุ' });
    }

    await pool.query('UPDATE member SET perm_id = 3 , is_verified = 1 WHERE email = ?', [email.trim().toLowerCase()]);
    await redisClient.del(key);
    await redisClient.del(attemptsKey);
    return res.json({ message: 'ยืนยันอีเมลสำเร็จแล้ว' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'เกิดข้อผิดพลาดในการยืนยันอีเมล' });
  }
});


router.post('/resend-otp', async (req, res) => {
  console.log('resend-otp body:', req.body);
  const { email, prefix, first_name, last_name } = req.body;

  try {
    const [userRows] = await pool.query('SELECT * FROM member WHERE email = ?', [email]);
    if (!userRows.length || (userRows[0].is_verified && userRows[0].is_verified > 1)) {
      return res.status(400).json({ message: 'ไม่พบผู้ใช้งานหรืออีเมลได้รับการยืนยันแล้ว' });
    }

    const key = `otp:${email}`;
    const ttlNow = await redisClient.ttl(key);
    if (ttlNow > 0) {
      return res.status(429).json({ message: `กรุณารออีก ${ttlNow} วินาทีก่อนส่ง OTP ใหม่`, ttl: ttlNow });
    }

    const otp = generateOTP();
    await redisClient.setEx(key, otpExpirySeconds, otp);

    await sendOtpEmail(email, prefix, first_name, last_name, otp);

    return res.json({ message: 'ส่ง OTP ใหม่สำเร็จ กรุณาตรวจสอบอีเมล', ttl: otpExpirySeconds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการส่ง OTP ใหม่' });
  }
});


async function sendOtpEmail(email, prefix, firstName, lastName, otp) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #f7f7f7; padding: 20px; text-align: center; border-bottom: 1px solid #eee;">
        <h2 style="color: #0056b3; margin: 0;">ระบบตรวจสอบและประมวลคำสั่งเอสคิวแอล</h2>
      </div>
      <div style="padding: 30px 20px;">
        <p style="font-size: 16px; margin-bottom: 20px;">เรียนผู้ใช้งาน, ${prefix}${firstName} ${lastName}</p>
        <p style="font-size: 16px; margin-bottom: 20px;">
          นี่คือรหัสยืนยันอีเมลของคุณ:
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <span style="display: inline-block; background-color: #e9ecef; color: #007bff; font-size: 32px; font-weight: bold; padding: 15px 30px; border-radius: 8px; letter-spacing: 3px;">
            ${otp}
          </span>
        </div>
        <p style="font-size: 14px; color: #777; text-align: center;">รหัสนี้จะหมดอายุภายใน <b>10 นาที</b> กรุณาอย่าเปิดเผยรหัสนี้แก่ผู้อื่น</p>
        <p style="font-size: 16px; margin-top: 30px;">หากคุณไม่ได้ร้องขอรหัสนี้ กรุณาเพิกเฉยอีเมลฉบับนี้</p>
      </div>
      <div style="background-color: #f7f7f7; padding: 20px; text-align: center; font-size: 12px; color: #777; border-top: 1px solid #eee;">
        <p>&copy; ${new Date().getFullYear()} Query Checking System : QCS. All rights reserved.</p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"Query Checking System : QCS" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'รหัสยืนยันอีเมลของคุณ',
    html,
  });
}

export default router;
