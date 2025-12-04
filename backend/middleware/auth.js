import jwt from 'jsonwebtoken';

export function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return res.status(401).json({ message: 'ไม่พบ Token (Authorization header)' });
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Token ไม่ถูกต้อง' });
  }

  jwt.verify(token, process.env.JWT_ACCESS_SECRET, (err, decoded) => {
    if (err) {
      console.error('JWT verify error:', err);
      return res.status(401).json({ message: 'Token หมดอายุหรือไม่ถูกต้อง' });
    }

    req.user = decoded;
    next();
  });
}