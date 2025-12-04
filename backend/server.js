import express from 'express';
import session from 'express-session';
import dotenv from 'dotenv';
import cors from 'cors';

import JWTdecode from './middleware/jwtdecode.js';
import userRoute from './middleware/user.js';

import Register from './routes/register.js';
import AuthRoute from './routes/auth.js';
import LogOutRoute from './routes/logout.js';

import GroupController from './routes/groupscontroller.js';

import SQL from './routes/sql.js';
import database from './routes/database.js';
import cookieParser from 'cookie-parser';
import permission from './routes/permission.js';
import Exam from './routes/exam.js';
import examSubmission from './routes/exam_submission.js';
import sqlparser from './routes/sqlparser.js'
import unit from './routes/unit.js';
import purpose from './routes/purpose.js';
import questions from './routes/questions.js';
import questionset from './routes/questionsset.js';
import examsystem from './routes/examsystem.js';
import Exercise from './routes/exercise.js';
import submission from './routes/submission.js';
import setting from './routes/setting.js'

import SQLChecker from './sqlchecker/worker.js';


const allowedOrigins = ['https://cqcportal.site', 'https://www.cqcportal.site', 'http://localhost:3001', 'http://localhost:3000'];

dotenv.config();

const app = express();
const PORT = 3001;
const router = express.Router();
const apiPrefix = process.env.API_PREFIX;

app.use(express.json());
app.set('trust proxy', true);
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: false,
    maxAge: 1000 * 60 * 60
  }
}));

app.use(cors({
  origin: function (origin, callback) {
    console.log('CORS - Origin:', origin);
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('CORS - Origin not allowed:', origin);
      callback(null, true);
      //callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

if (typeof SQLChecker === 'function') {
  SQLChecker();
}

router.get('/', (req, res) => {
  res.send('Welcome to the CPE Management System API');
});

router.use('/user', userRoute);
router.use('/register', Register);

router.use('/auth', AuthRoute);

router.use('/logout', LogOutRoute);
router.use('/groups', GroupController);
router.use('/sql', SQL);
router.use('/exam', Exam);
router.use('/examSubmission', examSubmission);
router.use('/unit', unit);
router.use('/purpose', purpose);
router.use('/database', database);
router.use('/permission', permission);
router.use('/sqlparser',sqlparser);
router.use('/questions',questions);
router.use('/questionset', questionset);
router.use('/examsystem', examsystem);
router.use('/exercise', Exercise);
router.use('/submission', submission);
router.use('/setting', setting);
router.get('/secure-data', JWTdecode, (req, res) => {
  res.json({ message: 'ข้อมูลลับ', user: req.user });
});

app.use(apiPrefix, router);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
