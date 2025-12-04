import e from 'express';
import pool from '../config/db.js';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

import { fileURLToPath } from 'url';
import { checkSQLStructure } from './sqlparser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, '../.env') 
});

function logToFile(message) {
    const logPath = path.resolve(__dirname, '../logs/worker.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
}

async function checkQueueLoop() {
    while (true) {
        //console.log('Checking queue for pending tasks...');
        const [queueRows] = await pool.query(
            'SELECT * FROM queue WHERE checked = 0 ORDER BY queue_at LIMIT 1'
        );

        if (queueRows.length === 0) {
            //console.log('No pending tasks in the queue.');
        } else {
            const { user_id, assignment_id, attempt_no } = queueRows[0];
            const [submissionRows] = await pool.query(
                'SELECT * FROM submission WHERE user_id=? AND assignment_id=? AND attempt_no=?',
                [user_id, assignment_id, attempt_no]
            );

            if (submissionRows.length === 0) {
                console.log('No submission found for this queue.');
            } else {
                for (const submission of submissionRows) {
                    let studentSQL = '';
                    try {
                        const ansObj =
                            typeof submission.answers_json === 'string'
                                ? JSON.parse(submission.answers_json)
                                : submission.answers_json;
                        studentSQL = ansObj.sql || '';
                    } catch (e) {
                        console.error('Cannot parse answers_json:', e);
                        studentSQL = '';
                    }

                    // ดึงโจทย์เฉพาะข้อที่ตรงกับ question_id
                    const [questionRows] = await pool.query(
                        'SELECT * FROM question WHERE question_id=?',
                        [submission.question_id]
                    );
                    const teacherSQL = questionRows[0]?.answer || '';
                    const questionName = questionRows[0]?.question_name || '';
                    const databaseId = questionRows[0]?.database_id;
                    const qresultScore = Number(questionRows[0]?.result_score) || 0;
                    const qsyntaxScore = Number(questionRows[0]?.syntax_score) || 0;

                    // ดึงข้อมูล database จาก database_list
                    const [dbRows] = await pool.query(
                        'SELECT * FROM database_list WHERE database_id=?',
                        [databaseId]
                    );
                    const dbInfo = dbRows[0];
                    if (!dbInfo) {
                        console.error('ไม่พบข้อมูล database_list สำหรับ database_id:', databaseId);
                        continue;
                    }

                    // สร้าง connection ไปยัง database ที่ถูกต้อง
                    const dbConn = await mysql.createConnection({
                        host: process.env.DB_HOST,
                        user: process.env.DB_USER,
                        password: process.env.DB_PASS,
                        database: dbInfo.database_name,
                        port: 3306,
                        multipleStatements: true
                    });

                    // ตรวจผลลัพธ์ SQL ทั้งสองฝั่ง
                    let studentResult = [];
                    let teacherResult = [];
                    try {
                        [studentResult] = await dbConn.query(studentSQL);
                    } catch (e) {
                        console.error('Student SQL execution error:', e.message);
                    }
                    try {
                        [teacherResult] = await dbConn.query(teacherSQL);
                    } catch (e) {
                        console.error('Teacher SQL execution error:', e.message);
                    }
                    await dbConn.end();

                    // เปรียบเทียบผลลัพธ์
                    const resultMatch = JSON.stringify(studentResult) === JSON.stringify(teacherResult);

                    let syntaxScore = 0;
                    let resultScore = 0;
                    let compareError = false;
                    logToFile(`-------------------------------`);
                    logToFile(`ข้อ: ${questionName}`);

                    try {
                        console.log('Comparing SQL structure...');
                        const gradeResults = await checkSQLStructure(studentSQL, teacherSQL);
                        syntaxScore = (qsyntaxScore * (gradeResults.score / 100));
                        resultScore = resultMatch ? qresultScore : 0;
                        logToFile(`เปอร์เซ็นต์โครงสร้าง: ${gradeResults.score}%`);
                        /*if (gradeResults.issues && gradeResults.issues.length > 0) {
                            logToFile('โครงสร้างที่ต่างกัน: ' + JSON.stringify(gradeResults.issues));
                        }*/
                    } catch (err) {
                        syntaxScore = 0;
                        resultScore = 0;
                        compareError = true;
                        console.error('SQL Compare Error:', err.message);
                    }

                    const result = await checkSQLStructure(studentSQL, teacherSQL);

                    const keywordList = String(questionRows[0]?.keyword || "")
                      .split(",")
                      .map(k => k.trim().toUpperCase())
                      .filter(Boolean);

                    const keywordScoreFull = Number(questionRows[0]?.keyword_score) || 0;
                    let keywordScore = 0;
                    if (keywordList.length > 0 && keywordScoreFull > 0) {
                      let found = 0;
                      const studentSQLUpper = String(studentSQL).toUpperCase();
                      keywordList.forEach(k => {
                        if (studentSQLUpper.includes(k)) found++;
                      });
                      keywordScore = (found / keywordList.length) * keywordScoreFull;
                    }

                    // ป้องกัน NaN
                    if (isNaN(syntaxScore)) syntaxScore = 0;
                    if (isNaN(resultScore)) resultScore = 0;
                    if (isNaN(keywordScore)) keywordScore = 0;

                    await pool.query(
                      'UPDATE submission SET syntax_score=?, result_score=?, keyword_score=? WHERE user_id=? AND assignment_id=? AND question_id=? AND attempt_no=?',
                      [syntaxScore, resultScore, keywordScore, user_id, assignment_id, submission.question_id, attempt_no]
                    );

                    
                    logToFile(`คะแนนโครงสร้าง: ${syntaxScore} / ${qsyntaxScore}`);
                    logToFile(`คะแนนผลลัพธ์: ${resultScore} / ${qresultScore}`);
                    logToFile(`คะแนนคำสำคัญ: ${keywordScore} / ${keywordScoreFull}`);
                    if (compareError) {
                        logToFile('นักเรียนเขียน SQL ไม่ถูกต้องหรือ syntax error');
                    } else {
                        logToFile(`ผลลัพธ์: ${resultMatch ? 'ตรงกัน' : 'ไม่ตรงกัน'}`);
                        /*if (!resultMatch) {
                            logToFile('ผลลัพธ์นักเรียน: ' + JSON.stringify(studentResult));
                            logToFile('ผลลัพธ์ครู: ' + JSON.stringify(teacherResult));
                        }*/
                    }
                }
                await pool.query(
                    'UPDATE queue SET checked = 1 WHERE user_id=? AND assignment_id=? AND attempt_no=?',
                    [user_id, assignment_id, attempt_no]
                );
            }
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

export default checkQueueLoop;
