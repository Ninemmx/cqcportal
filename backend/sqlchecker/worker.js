import pool from '../config/db.js';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

import { fileURLToPath } from 'url';
import { checkSQLStructure } from './sqlparser.js';
import { compareResults, percentageCompareResults } from './resultsCompare.js';
import { getSQLType, checkDeleteStructure, checkDeleteResults, checkInsertStructure, checkInsertResults, checkUpdateStructure, checkUpdateResults } from './sqlTypeChecker.js';

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
            'SELECT queue_id, user_id, target_type, target_id, attempt_no, queue_at FROM queue WHERE checked = 0 ORDER BY queue_at LIMIT 1');
        if (queueRows.length === 0) {
            //console.log('No pending tasks in the queue.');
        } else {
            const queueItem = queueRows[0];
            const { user_id, attempt_no, queue_id } = queueItem;

            // [แก้ไขแล้ว] ตรวจสอบว่าเป็น Assignment หรือ Exam
            let idColumn, idValue, type;
            if (queueItem.target_type === 'assignment') {
                idColumn = 'assignment_id';
                idValue = queueItem.target_id;
                type = 'Assignment';
            } else if (queueItem.target_type === 'exam') {
                idColumn = 'exam_id';
                idValue = queueItem.target_id;
                type = 'Exam';
            } else {
                console.error(`Queue item ${queue_id} has invalid target_type: ${queueItem.target_type}.`);
                // Mark as checked to avoid infinite loop
                await pool.query('UPDATE queue SET checked = 2 WHERE queue_id = ?', [queue_id]); // ใช้ checked = 2 สำหรับ Error
                continue; // ข้ามไปรายการถัดไป
            }

            logToFile(`Processing Queue ID: ${queue_id}, Type: ${type}, ID: ${idValue}, User: ${user_id}, Attempt: ${attempt_no}`);

            // [แก้ไขแล้ว] เลือกตารางที่เหมาะสมตามประเภท
            let submissionTable, jsonColumn;
            if (type === 'Assignment') {
                submissionTable = 'assignment_submission';
                jsonColumn = 'answer_json';  // ตาราง assignment_submission ใช้ answer_json
            } else {
                submissionTable = 'exam_submission';
                jsonColumn = 'answers_json';  // ตาราง exam_submission ใช้ answers_json
            }
            
            const [submissionRows] = await pool.query(
                `SELECT * FROM ${submissionTable} WHERE user_id=? AND ${idColumn}=? AND attempt_no=?`,
                [user_id, idValue, attempt_no]
            );

            if (submissionRows.length === 0) {
                logToFile(`No submission rows found for Queue ID: ${queue_id}. Marking as checked.`);
                // Mark as checked even if no submissions found to prevent loop
                await pool.query('UPDATE queue SET checked = 1 WHERE queue_id = ?', [queue_id]); // [แก้ไขแล้ว] อัปเดตด้วย queue_id
            } else {
                // --- START: Improvement ---
                // ดึงข้อมูล database และสร้าง connection เพียงครั้งเดียวสำหรับทุก submission ใน attempt เดียวกัน
                // เพราะการบ้านชุดเดียวกันมักจะใช้ฐานข้อมูลเดียวกัน
                const firstSubmission = submissionRows[0];
                const [firstQuestionRows] = await pool.query(
                    'SELECT database_id FROM question WHERE question_id=?',
                    [firstSubmission.question_id]
                );
                const databaseId = firstQuestionRows[0]?.database_id;
                let dbConn;

                if (databaseId) {
                    const [dbRows] = await pool.query(
                        'SELECT * FROM database_list WHERE database_id=?',
                        [databaseId]
                    );
                    const dbInfo = dbRows[0];
                    if (dbInfo) {
                        dbConn = await mysql.createConnection({
                            host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASS,
                            database: dbInfo.database_name, port: 3306, multipleStatements: true
                        });
                    }
                }
                // --- END: Improvement ---

                for (const submission of submissionRows) {
                    let studentSQL = '';
                    let resultComparison = null;

                    try {
                        const ansObj =
                            typeof submission[jsonColumn] === 'string'
                                ? JSON.parse(submission[jsonColumn])
                                : submission[jsonColumn];
                        studentSQL = ansObj.sql || '';
                    } catch (e) {
                        console.error(`Cannot parse ${jsonColumn}:`, e);
                        studentSQL = '';
                    }
                    
                    // ลบคอมเมนต์ออกก่อนตรวจสอบประเภท SQL
                    const cleanStudentSQL = studentSQL.replace(/(--[^\n]*\n?)/g, '').trim();

                    // ดึงโจทย์เฉพาะข้อที่ตรงกับ question_id
                    const [questionRows] = await pool.query(
                        'SELECT * FROM question WHERE question_id=?',
                        [submission.question_id]
                    );
                    const teacherSQL = questionRows[0]?.answer || '';
                    const questionName = questionRows[0]?.question_name || '';
                    const questionId = submission.question_id;

                    // ดึงคะแนนรวมจาก question_score และคำนวณคะแนนย่อยตามสัดส่วน
                    const questionScore = Number(questionRows[0]?.question_score) || 0;
                    const qkeywordScore = questionScore * 0.33;  // 33% สำหรับ keyword
                    const qsyntaxScore = questionScore * 0.33;   // 33% สำหรับ syntax
                    const qresultScore = questionScore * 0.34;   // 34% สำหรับ result

                    if (!dbConn) {
                        console.error('ไม่สามารถสร้าง DB Connection สำหรับ question_id:', questionId);
                        continue;
                    }

                    const sqlType = getSQLType(cleanStudentSQL); // ฟังก์ชันตรวจสอบประเภทคำสั่ง SQL

                    let syntaxScore = 0;
                    let resultScore = 0;
                    let compareError = false;

                    logToFile('----------------------------------------');
                    logToFile(`Processing submission for question: ${questionName} (ID: ${questionId})`);

                    logToFile(`(User: ${user_id}, ${type}: ${idValue}, Attempt: ${attempt_no}, Question ID: ${questionId}) `);
                    logToFile(`SQL Type: ${sqlType}`);

                    if (sqlType === 'unknown' || sqlType === 'unsupported') {
                        // กรณีไม่รู้จักประเภท SQL หรือไม่รองรับ
                        compareError = true;
                        syntaxScore = 0;
                        resultScore = 0;
                        
                        if (sqlType === 'unknown') {
                            logToFile('Unknown SQL type - cannot determine command type');
                        } else if (sqlType === 'unsupported') {
                            logToFile('Unsupported SQL type - command not supported for checking');
                        }
                    } else if (sqlType === 'delete') {
                        // ตรวจสอบคำสั่ง DELETE
                        try {
                            // ตรวจสอบโครงสร้าง
                            const structureResult = await checkDeleteStructure(cleanStudentSQL, teacherSQL);
                            syntaxScore = (qsyntaxScore * (structureResult.score / 100));

                            // ตรวจสอบผลลัพธ์
                            const deleteResult = await checkDeleteResults(cleanStudentSQL, teacherSQL, dbConn, questionRows[0]?.test_table);
                            resultScore = deleteResult.score * qresultScore;

                            logToFile(`DELETE Result Score: ${deleteResult.score}, Reason: ${deleteResult.reason}`);
                            if (deleteResult.error) {
                                compareError = true;
                                logToFile(`DELETE Error: ${deleteResult.error}`);
                            }
                        } catch (err) {
                            syntaxScore = 0;
                            resultScore = 0;
                            compareError = true;
                            console.error('DELETE SQL Error:', err.message);
                            logToFile(`DELETE SQL Error: ${err.message}`);
                        }
                    } else if (sqlType === 'insert') {
                        // ตรวจสอบคำสั่ง INSERT
                        try {
                            // ตรวจสอบโครงสร้าง
                            const structureResult = await checkInsertStructure(cleanStudentSQL, teacherSQL);
                            syntaxScore = (qsyntaxScore * (structureResult.score / 100));

                            // ตรวจสอบผลลัพธ์
                            const insertResult = await checkInsertResults(cleanStudentSQL, teacherSQL, dbConn, questionRows[0]?.test_table);
                            resultScore = insertResult.score * qresultScore;

                            logToFile(`INSERT Result Score: ${insertResult.score}, Reason: ${insertResult.reason}`);
                            if (insertResult.error) {
                                compareError = true;
                                logToFile(`INSERT Error: ${insertResult.error}`);
                            }
                        } catch (err) {
                            syntaxScore = 0;
                            resultScore = 0;
                            compareError = true;
                            console.error('INSERT SQL Error:', err.message);
                            logToFile(`INSERT SQL Error: ${err.message}`);
                        }
                    } else if (sqlType === 'update') {
                        // ตรวจสอบคำสั่ง UPDATE
                        try {
                            // ตรวจสอบโครงสร้าง
                            const structureResult = await checkUpdateStructure(cleanStudentSQL, teacherSQL);
                            syntaxScore = (qsyntaxScore * (structureResult.score / 100));

                            // ตรวจสอบผลลัพธ์
                            const updateResult = await checkUpdateResults(cleanStudentSQL, teacherSQL, dbConn, questionRows[0]?.test_table);
                            resultScore = updateResult.score * qresultScore;

                            logToFile(`UPDATE Result Score: ${updateResult.score}, Reason: ${updateResult.reason}`);
                            if (updateResult.error) {
                                compareError = true;
                                logToFile(`UPDATE Error: ${updateResult.error}`);
                            }
                        } catch (err) {
                            syntaxScore = 0;
                            resultScore = 0;
                            compareError = true;
                            console.error('UPDATE SQL Error:', err.message);
                            logToFile(`UPDATE SQL Error: ${err.message}`);
                        }
                    } else {
                        // ตรวจสอบคำสั่ง SELECT แบบเดิม
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

                        // เปรียบเทียบผลลัพธ์
                        resultComparison = percentageCompareResults(studentResult, teacherResult);
                        // แบบที่ 1 Exact match
                        //const resultMatch = simpleCompareResults(studentResult, teacherResult);
                        // แบบที่ 2 Flexible match
                        const resultMatch = resultComparison.score;

                        try {
                            //console.log('Comparing SQL structure...');
                            const structureResult = await checkSQLStructure(cleanStudentSQL, teacherSQL);
                            syntaxScore = (qsyntaxScore * (structureResult.score / 100));
                            resultScore = (resultMatch / 1.0) * qresultScore; // ใช้คะแนนจาก resultMatch (0-1)
                            //logToFile(`เปอร์เซ็นต์โครงสร้าง: ${structureResult.score}%`);
                            /*if (gradeResults.issues && gradeResults.issues.length > 0) {
                                logToFile('โครงสร้างที่ต่างกัน: ' + JSON.stringify(gradeResults.issues));
                            }*/
                        } catch (err) {
                            syntaxScore = 0;
                            resultScore = 0;
                            compareError = true;
                            console.error('SQL Compare Error:', err.message);
                        }

                        if (!compareError) {
                            logToFile(`เปอร์เซ็นต์ผลลัพธ์: ${resultComparison.percentage}%`);
                            logToFile(`เหตุผล: ${resultComparison.reason}`);
                        }
                    }

                    const keywordList = String(questionRows[0]?.keyword || "")
                        .split(",")
                        .map(k => k.trim())
                        .filter(Boolean);

                    // ใช้ค่า qkeywordScore ที่คำนวณจาก questionScore แล้ว
                    const keywordScoreFull = qkeywordScore;
                    let keywordScore = 0;

                    const hasKeywords = keywordList.length > 0;

                    if (keywordList.length > 0 && keywordScoreFull > 0) {
                        let found = 0;
                        keywordList.forEach(k => {
                            if (studentSQL.includes(k) || studentSQL.toLowerCase().includes(k.toLowerCase())) found++;
                        });
                        keywordScore = (found / keywordList.length) * keywordScoreFull;
                    }

                    // ถ้าไม่มี keyword ให้คะแนนเต็มในส่วนของ keyword
                    if (!hasKeywords) {
                        keywordScore = keywordScoreFull;
                        logToFile(`No keywords defined. Giving full keyword score: ${keywordScoreFull}`);
                    }

                    // ป้องกัน NaN
                    if (isNaN(syntaxScore)) syntaxScore = 0;
                    if (isNaN(resultScore)) resultScore = 0;
                    if (isNaN(keywordScore)) keywordScore = 0;

                    const originalTotalScore = syntaxScore + resultScore + keywordScore;

                    let finalTotalScore = originalTotalScore;
                    let penaltyApplied = 0; // สถานะการหักคะแนน (0 = ไม่หัก, 1 = หักแล้ว)

                    if (submission.is_late === 1 && type === 'Assignment') { // หักคะแนนเฉพาะ Assignment
                        const penaltyPercentage = 0.30; // กำหนดเปอร์เซ็นต์การหัก 30%
                        finalTotalScore = originalTotalScore * (1 - penaltyPercentage);
                        penaltyApplied = 1;
                        logToFile(`[Queue ${queue_id}] Late submission. Applying ${penaltyPercentage * 100}% penalty.`);
                    }

                    finalTotalScore = Math.round(finalTotalScore * 100) / 100;

                    await pool.query(
                        `UPDATE ${submissionTable} SET syntax_score=?, result_score=?, keyword_score=?, original_score=?, final_score=?, late_penalty_applied=?
                              WHERE user_id=? AND ${idColumn}=? AND question_id=? AND attempt_no=?`,
                        [
                            syntaxScore,
                            resultScore,
                            keywordScore,
                            originalTotalScore,
                            finalTotalScore,
                            penaltyApplied,
                            user_id,
                            idValue,
                            submission.question_id,
                            attempt_no
                        ]
                    );

                    /* await pool.query(
                         'UPDATE submission SET syntax_score=?, result_score=?, keyword_score=? WHERE user_id=? AND assignment_id=? AND question_id=? AND attempt_no=?',
                         [syntaxScore, resultScore, keywordScore, user_id, assignment_id, submission.question_id, attempt_no]
                     );*/

                    logToFile(`Score: keyword=${keywordScore}/${keywordScoreFull}, syntax=${syntaxScore}/${qsyntaxScore}, result=${resultScore}/${qresultScore}`);
                    if (compareError) {
                        if (sqlType === 'unknown') {
                            logToFile('นักเรียนเขียน SQL ไม่สามารถระบุประเภทได้');
                        } else if (sqlType === 'unsupported') {
                            logToFile('นักเรียนเขียน SQL ที่ไม่รองรับในระบบ');
                        } else {
                            logToFile('นักเรียนเขียน SQL ไม่ถูกต้องหรือ syntax error');
                        }
                    } else if (sqlType === 'delete') {
                        logToFile(`DELETE operation completed successfully`);
                    } else if (sqlType === 'insert') {
                        logToFile(`INSERT operation completed successfully`);
                    } else if (sqlType === 'update') {
                        logToFile(`UPDATE operation completed successfully`);
                    } else if (resultComparison) {
                        // สำหรับคำสั่งอื่นๆ (เช่น SELECT)
                        logToFile(`เปอร์เซ็นต์ผลลัพธ์: ${resultComparison.percentage}%`);
                        logToFile(`เหตุผล: ${resultComparison.reason}`);
                    }
                }

                if (dbConn) {
                    await dbConn.end();
                }

                const finalCheckStatus = 1;
                await pool.query(
                    'UPDATE queue SET checked = ? WHERE queue_id = ?',
                    [finalCheckStatus, queue_id]
                );
                logToFile(`[Queue ${queue_id}] Marked as checked with status: ${finalCheckStatus}.`);

            }
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}



export default checkQueueLoop;
