import express from 'express';
import 'dotenv/config';
import authRoutes from './routes/auth.js';
import { authMiddleware } from './middleware/auth.js';
import cors from 'cors';

const app = express();

// ตั้งค่า CORS
const allowedOrigins = [
  process.env.FRONTEND_DEV_URL || 'http://localhost:5174', // พอร์ตของ frontend ในโหมด development
  process.env.FRONTEND_PROD_URL || 'https://test.cqcportal.site' // URL ของ frontend ในโหมด production
];

app.use(cors({
  origin: function (origin, callback) {
    // อนุญาตการเข้าถึงจาก origin ที่อยู่ในรายการ หรือไม่มี origin (เช่น การเรียกจาก Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true // อนุญาตให้ส่งคุ้กกี้
}));

app.use(express.json());

app.use('/auth', authRoutes);

app.get('/me', authMiddleware, (req, res) => {
  res.json({
    message: 'โปรไฟล์ของคุณ',
    user: req.user,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
