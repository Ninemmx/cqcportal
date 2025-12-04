import express from 'express';
import 'dotenv/config';
import authRoutes from './routes/auth.js';
import { authMiddleware } from './middleware/auth.js';

const app = express();

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
