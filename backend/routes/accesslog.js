import express from 'express';
import mysql from '../config/mysql.js';
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();

router.use()(express.json());

router.get('/', async (req , res) => {
    try {
        const [row] = await mysql.query('SELECT * FROM accesslog ORDER BY CREATED_AT DESC');
        res.json(row);

    } catch (err) {
        console.error('ดึงข้อมูล accesslog ล้มเหลว:', err.message || err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูล accesslog' });
    }

});

router.post('/addlog', async (req, res) => {
    const { uid , action	} = req.body;
    if (!uid ||  !action ) {
        return res.status(400).json({ message: 'ข้อมูลไม่ครบถ้วน' });
    }
  const ipaddress = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const user_agent = req.headers['user-agent'] || 'unknown';
  const referrer = req.headers['referer'] || req.headers['referrer'] || 'unknown';

    if (!ipaddress || !user_agent || !referrer) {
        return res.status(400).json({ message: 'ข้อมูล IP, User-Agent หรือ Referrer ไม่ถูกต้อง' });
    }

    try {
        await mysql.query(
            'INSERT INTO accesslog ( uid,ipaddress, action, user_agent, referrer, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
            [uid, ipaddress, action, user_agent, referrer]
        );
        res.status(201).json({ message: 'บันทึก accesslog สำเร็จ' });
    } catch (err) {
        console.error('บันทึก accesslog ล้มเหลว:', err.message || err);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการบันทึก accesslog' });
    }
    });