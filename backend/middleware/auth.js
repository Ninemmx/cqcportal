import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

async function auth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.uid;
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Unauthorized' });
  }
}

export default auth