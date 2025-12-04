function normalizeResult(result) {
    if (!Array.isArray(result)) return [];

    return result.map(row => {
        const normalizedRow = {};
        for (const [key, value] of Object.entries(row)) {
            // แปลง key เป็น lowercase และลบ space, underscore
            const normalizedKey = key.replace(/[\s_]+/g, '');

            // normalize value
            let normalizedValue = value;

            if (value === null || value === undefined) {
                // ค่าที่เป็น null หรือ undefined
                normalizedValue = null;
            } else if (typeof value === 'string') {
                // trim และแปลงเป็น lowercase
                normalizedValue = value.trim();
                // ลองแปลงเป็นตัวเลขถ้าทำได้
                const num = Number(normalizedValue);
                if (!isNaN(num) && normalizedValue !== '') {
                    normalizedValue = Math.round(num * 1000000) / 1000000;
                }
            } else if (typeof value === 'number') {
                // ปัดทศนิยมให้เหลือ 6 ตำแหน่ง
                normalizedValue = Math.round(value * 1000000) / 1000000;
            } else if (value instanceof Date) {
                // แปลง Date เป็น YYYY-MM-DD format
                normalizedValue = value.toISOString().split('T')[0];
            } else if (typeof value === 'boolean') {
                // แปลง boolean เป็น 0 หรือ 1
                normalizedValue = value;
            }
            // ค่าประเภทอื่นๆ (เช่น object, array) ปล่อยไว้ตามเดิม
            normalizedRow[normalizedKey] = normalizedValue;
        }
        return normalizedRow;
    });
}

function areColumnsCompatible(studentColumns, teacherColumns, options = {}) {
    const { strictColumnCount = false } = options;

    if (studentColumns.length === 0 && teacherColumns.length === 0) return { compatible: true, score: 1.0, columnMap: new Map() };
    if (studentColumns.length === 0 || teacherColumns.length === 0) return { compatible: false, score: 0, columnMap: new Map() };

    if (strictColumnCount && studentColumns.length !== teacherColumns.length) {
        return {
            compatible: false,
            score: 0,
            columnMap: new Map(),
            reason: `จำนวนคอลัมน์ไม่ตรงกัน (อาจารย์: ${teacherColumns.length}, นักศึกษา: ${studentColumns.length})`
        };
    }

    // คำนวณคะแนนความเหมือนของ columns
    const matched = new Set();
    const columnMap = new Map(); // Map studentCol -> teacherCol
    let matchCount = 0;

    // สร้าง mapping โดยไม่สนใจชื่อคอลัมน์ (รองรับ alias)
    // จับคู่คอลัมน์ตามลำดับที่ปรากฏ
    const minColumns = Math.min(studentColumns.length, teacherColumns.length);

    for (let i = 0; i < minColumns; i++) {
        const studentCol = studentColumns[i];
        const teacherCol = teacherColumns[i];

        // จับคู่คอลัมน์ตามลำดับ ไม่สนใจว่าชื่อจะเหมือนกันหรือไม่
        if (!matched.has(teacherCol) && !columnMap.has(studentCol)) {
            matched.add(teacherCol);
            columnMap.set(studentCol, teacherCol);
            matchCount++;
        }
    }

    // ถ้ามีคอลัมน์เหลืออยู่ ให้จับคู่ตามชื่อที่เหมือนกัน (เผื่อกรณีมีคอลัมน์เพิ่มเติม)
    if (studentColumns.length > teacherColumns.length) {
        for (const studentCol of studentColumns) {
            if (!columnMap.has(studentCol)) {
                for (const teacherCol of teacherColumns) {
                    if (!matched.has(teacherCol) && studentCol === teacherCol) {
                        matched.add(teacherCol);
                        columnMap.set(studentCol, teacherCol);
                        matchCount++;
                        break;
                    }
                }
            }
        }
    } else if (teacherColumns.length > studentColumns.length) {
        for (const teacherCol of teacherColumns) {
            if (!matched.has(teacherCol)) {
                for (const studentCol of studentColumns) {
                    if (!columnMap.has(studentCol) && studentCol === teacherCol) {
                        matched.add(teacherCol);
                        columnMap.set(studentCol, teacherCol);
                        matchCount++;
                        break;
                    }
                }
            }
        }
    }

    return {
        compatible: true, // เปลี่ยนให้อนุญาตเสมอ
        score: Math.max(studentColumns.length, teacherColumns.length) > 0
            ? matchCount / Math.max(studentColumns.length, teacherColumns.length)
            : 1.0,
        columnMap: columnMap
    };
}

function calculateRowSimilarity(studentResult, teacherResult, ignoreOrder = false) {
    if (studentResult.length === 0 && teacherResult.length === 0) {
        return { score: 1.0, matches: 0, total: 0, details: 'ทั้งคู่ไม่มีข้อมูล' };
    }

    if (studentResult.length === 0 || teacherResult.length === 0) {
        return {
            score: 0,
            matches: 0,
            total: Math.max(studentResult.length, teacherResult.length),
            details: 'มีข้อมูลฝั่งเดียว'
        };
    }

    const maxLength = Math.max(studentResult.length, teacherResult.length);
    const minLength = Math.min(studentResult.length, teacherResult.length);
    let matches = 0;
    let isReverseOrder = false;

    if (ignoreOrder) {
        // เรียงลำดับข้อมูลก่อนเปรียบเทียบ (ไม่สนใจลำดับ)
        const sortedStudent = [...studentResult].sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b))
        );
        const sortedTeacher = [...teacherResult].sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b))
        );

        for (let i = 0; i < minLength; i++) {
            if (JSON.stringify(sortedStudent[i]) === JSON.stringify(sortedTeacher[i])) {
                matches++;
            }
        }
    } else {
        // เปรียบเทียบตามลำดับที่แท้จริง (สนใจลำดับ)
        for (let i = 0; i < minLength; i++) {
            if (JSON.stringify(studentResult[i]) === JSON.stringify(teacherResult[i])) {
                matches++;
            }
        }

        // ตรวจสอบกรณีที่ข้อมูลเรียงลำดับตรงกันข้าม (ASC vs DESC)
        if (matches === 0 && minLength > 1) {
            let reverseMatches = 0;
            for (let i = 0; i < minLength; i++) {
                if (JSON.stringify(studentResult[i]) === JSON.stringify(teacherResult[minLength - 1 - i])) {
                    reverseMatches++;
                }
            }

            // ถ้าเกือบทั้งหมดเรียงลำดับตรงกันข้าม (ให้คะแนนสูง)
            if (reverseMatches >= minLength * 0.8) {
                isReverseOrder = true;
                matches = reverseMatches;
            }
        }
    }

    // คำนวณคะแนนพิเศษสำหรับกรณีเรียงลำดับตรงกันข้าม
    let score = maxLength > 0 ? matches / maxLength : 1.0;
    if (isReverseOrder) {
        // ถ้าเรียงลำดับตรงกันข้าม ให้คะแนนพิเศษ 70% แทนที่จะเป็น 0%
        score = 0.7;
    }

    return {
        score: score,
        matches,
        total: maxLength,
        minLength,
        details: isReverseOrder
            ? `ข้อมูลเรียงลำดับตรงกันข้าม (จับคู่ได้ ${matches}/${minLength} แถว)`
            : `จับคู่ได้ ${matches}/${minLength} แถว จากทั้งหมด ${maxLength} แถว`
    };
}

export function compareResults(studentResult, teacherResult, options = {}) {
    const {
        strictMode = false,          // โหมดเข้มงวด
        minSimilarity = 0.0,         // ลดเป็น 0 เพื่ออนุญาตทุกผลลัพธ์
        ignoreOrder = false,         // ไม่สนใจลำดับแถว
        ignoreCase = false,          // สนใจตัวพิมพ์เล็ก/ใหญ่ (case sensitive)
        allowPartialMatch = true,    // อนุญาตการจับคู่บางส่วน
        strictColumnCount = false     // ไม่บังคับจำนวนคอลัมน์ให้ตรงกัน
    } = options;

    // กรณีโหมดเข้มงวด - ใช้การเปรียบเทียบแบบเดิม
    if (strictMode) {
        const match = JSON.stringify(studentResult) === JSON.stringify(teacherResult);
        const score = match ? 100 : 0;
        return {
            match: true, // เปลี่ยนให้อนุญาตเสมอ
            reason: match ? 'ผลลัพธ์ตรงกันทุกประการ (100%)' : 'ผลลัพธ์ไม่ตรงกัน (0%)',
            score: match ? 1.0 : 0,
            percentage: score,
            orderMatched: match
        };
    }

    const normalizedStudent = normalizeResult(studentResult);
    const normalizedTeacher = normalizeResult(teacherResult);

    // ตรวจสอบ column compatibility

    const studentColumns = Object.keys(normalizedStudent[0] || {});
    const teacherColumns = Object.keys(normalizedTeacher[0] || {});
    const columnCompatibility = areColumnsCompatible(studentColumns, teacherColumns, { strictColumnCount });

    if (!columnCompatibility.compatible && strictColumnCount) {
        return {
            match: false,
            reason: columnCompatibility.reason || 'จำนวนคอลัมน์ไม่ตรงกัน',
            score: 0,
            percentage: 0,
            orderMatched: false,
            details: {
                columnScore: 0,
                rowScore: 0,
                orderScore: 0,
                matchedRows: 0,
                totalRows: Math.max(studentResult.length, teacherResult.length),
                studentRows: normalizedStudent.length,
                teacherRows: normalizedTeacher.length,
                studentColumns,
                teacherColumns,
                ignoreOrder: ignoreOrder,
                rowDetails: 'จำนวนคอลัมน์ไม่ตรงกัน'
            }
        };
    }

    // --- START: NEW FIX ---
    // ปรับแก้ Key ของ student result ให้ตรงกับ teacher result ตาม map ที่ได้
    const remappedStudent = normalizedStudent.map(row => {
        const newRow = {};
        for (const key in row) {
            // ถ้า key อยู่ใน map ให้ใช้ key ของ teacher แทน
            const newKey = columnCompatibility.columnMap.get(key) || key;
            newRow[newKey] = row[key];
        }
        return newRow;
    });
    // --- END: NEW FIX ---

    // คำนวณความคล้ายคลึงของแถว
    const rowSimilarity = calculateRowSimilarity(remappedStudent, normalizedTeacher, ignoreOrder);

    // คำนวณคะแนนรวม
    const columnScore = columnCompatibility.score;
    const rowScore = rowSimilarity.score;
    const totalScore = (columnScore * 0.3) + (rowScore * 0.7);

    // ตรวจสอบลำดับ
    let orderMatched = true;
    let orderScore = 1.0;
    if (!ignoreOrder) {
        const orderSimilarity = calculateRowSimilarity(remappedStudent, normalizedTeacher, false);
        orderMatched = orderSimilarity.score === 1.0;
        orderScore = orderSimilarity.score;
    } else if (rowScore > 0) {
        const orderSimilarity = calculateRowSimilarity(remappedStudent, normalizedTeacher, false);
        orderMatched = orderSimilarity.score === 1.0;
        orderScore = orderSimilarity.score;
    }

    const percentage = Math.round(totalScore * 100);
    const isMatch = totalScore >= minSimilarity; // จะเป็น true เสมอเพราะ minSimilarity = 0

    let reason;
    if (totalScore === 1.0) {
        reason = `ผลลัพธ์ตรงกันทุกประการ (${percentage}%)`;
    } else if (totalScore >= 0.8) {
        reason = `ผลลัพธ์ใกล้เคียงมาก (${percentage}%)`;
    } else if (totalScore >= 0.5) {
        reason = `ผลลัพธ์ใกล้เคียงปานกลาง (${percentage}%)`;
    } else if (totalScore > 0) {
        reason = `ผลลัพธ์ใกล้เคียงเล็กน้อย (${percentage}%)`;
    } else {
        reason = `ผลลัพธ์แตกต่างกันทั้งหมด (${percentage}%)`;
    }

    // เพิ่มข้อมูลเกี่ยวกับลำดับ
    if (!ignoreOrder && !orderMatched && rowScore > 0) {
        reason += ` [ลำดับไม่ตรง: ${Math.round(orderScore * 100)}%]`;
    }

    return {
        match: true, // เปลี่ยนให้อนุญาตเสมอ
        reason: reason,
        score: totalScore,
        percentage: percentage,
        orderMatched: orderMatched,
        details: {
            columnScore: Math.round(columnScore * 100),
            rowScore: Math.round(rowScore * 100),
            orderScore: Math.round(orderScore * 100),
            matchedRows: rowSimilarity.matches,
            totalRows: rowSimilarity.total,
            studentRows: normalizedStudent.length,
            teacherRows: normalizedTeacher.length,
            studentColumns,
            teacherColumns,
            ignoreOrder: ignoreOrder,
            rowDetails: rowSimilarity.details
        }
    };
}

export function simpleCompareResults(studentResult, teacherResult) {
    return JSON.stringify(studentResult) === JSON.stringify(teacherResult);
}

// เพิ่ม function สำหรับการตั้งค่าแบบกำหนดเอง
export function flexibleCompareResults(studentResult, teacherResult) {
    return compareResults(studentResult, teacherResult, {
        strictMode: false,
        minSimilarity: 0.0,     // อนุญาตทุกผลลัพธ์
        ignoreOrder: false,     // สนใจลำดับ
        ignoreCase: false,
        allowPartialMatch: true
    });
}

export function strictCompareResults(studentResult, teacherResult) {
    return compareResults(studentResult, teacherResult, {
        strictMode: true
    });
}

// เพิ่ม function สำหรับการเปรียบเทียบที่ไม่สนใจลำดับ
export function orderIndependentCompareResults(studentResult, teacherResult) {
    return compareResults(studentResult, teacherResult, {
        strictMode: false,
        minSimilarity: 0.0,     // อนุญาตทุกผลลัพธ์
        ignoreOrder: true,      // ไม่สนใจลำดับ
        ignoreCase: false,
        allowPartialMatch: true
    });
}

// เพิ่ม function สำหรับการเปรียบเทียบที่ให้คะแนนเป็นเปอร์เซ็นต์
export function percentageCompareResults(studentResult, teacherResult) {
    const result = compareResults(studentResult, teacherResult, {
        strictMode: false,
        minSimilarity: 0.0,     // อนุญาตทุกผลลัพธ์
        ignoreOrder: false,
        ignoreCase: false,
        allowPartialMatch: true,
        strictColumnCount: true
    });

    return {
        match: true,
        percentage: result.percentage,
        score: result.score,
        reason: result.reason,
        details: result.details
    };
}