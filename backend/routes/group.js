import express from 'express';
import pool from '../config/db.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.get('/:gid', auth, async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT group_id, group_name FROM group_student WHERE group_id LIMIT 1`, [req.params.gid]);
        if (!rows.length) return res.status(404).json({ error: "Not found" });
        res.json(rows[0]);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "มีบางอย่างผิดพลาด ไม่สามารถดึงข้อมูลของกลุ่มได้" });
    }
});

router.get('/:gid/member', auth, async (req, res) => {
    try {   
        const [rows] = await pool.query(`SELECT user_id, prefix, first_name, last_name, email, student_id FROM member WHERE group_id = ?`, req.params.gid)
        if (!rows.length) return res.status(404).json({ error: "Not found" });
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "ไม่สามารถดึงข้อมูลผู้ใช้ในกลุ่มได้" });
    }
});



export default router;


