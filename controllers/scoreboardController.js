const mongoose = require('mongoose');
const TestResult = require('../models/TestResult');
const SubjectiveTestResult = require('../models/SubjectiveTestResult');
const UserAnswer = require('../models/UserAnswer');
const AiswbQuestion = require('../models/AiswbQuestion');
const ObjectiveTest = require('../models/ObjectiveTest');

exports.getUserScoreboard = async (req, res) => {
  try {
    const userId = req.user.id;
    const clientId = req.clientId;

    const objectiveMatch = { userId, status: 'completed' };
    if (clientId) objectiveMatch.clientId = clientId;

    const objectiveDocs = await TestResult.find(
      objectiveMatch,
      'testId score attemptHistory submittedAt totalQuestions'
    ).lean();

    let objectiveTotalAttempts = 0;
    let objectiveLastAttemptDate = null;
    const objectiveTestIds = new Set();
    let objectiveMarksEarnedSum = 0;
    let objectiveMarksPossibleSum = 0;

    // Get all unique test IDs to fetch test details
    const testIds = [...new Set(objectiveDocs.map(doc => doc.testId))];
    const testDetails = await ObjectiveTest.find(
      { _id: { $in: testIds } },
      '_id totalMarks'
    ).lean();
    const testMarksMap = new Map(testDetails.map(test => [String(test._id), test.totalMarks || 100]));

    for (const r of objectiveDocs) {
      objectiveTestIds.add(String(r.testId));

      const historyScores = Array.isArray(r.attemptHistory)
        ? r.attemptHistory.map((a) => (Number.isFinite(a?.totalMarksEarned) ? a.totalMarksEarned : null)).filter((x) => x !== null)
        : [];
      const historyDates = Array.isArray(r.attemptHistory)
        ? r.attemptHistory.map((a) => a?.submittedAt).filter(Boolean)
        : [];

      const hasHistory = historyScores.length > 0;
      const attemptScores = hasHistory
        ? historyScores
        : (Number.isFinite(r.score) ? [r.score] : []);

      // Get marks possible for this test
      const testMarksPossible = testMarksMap.get(String(r.testId)) || 5;

      // Aggregate objective totals
      objectiveTotalAttempts += attemptScores.length;
      for (const s of attemptScores) {
        objectiveMarksEarnedSum += s;
        objectiveMarksPossibleSum += 5;
      }

      // Last attempt date (max of history submittedAt and root submittedAt)
      const candidates = [...historyDates];
      if (r.submittedAt) candidates.push(r.submittedAt);
      for (const d of candidates) {
        if (!objectiveLastAttemptDate || new Date(d) > new Date(objectiveLastAttemptDate)) {
          objectiveLastAttemptDate = d;
        }
      }
    }

    const objectivePercentage = objectiveMarksPossibleSum > 0
      ? (objectiveMarksEarnedSum / objectiveMarksPossibleSum) * 100
      : 0;

    const subjectiveMatch = { userId, status: 'completed' };
    if (clientId) subjectiveMatch.clientId = clientId;

    const subjectiveDocs = await SubjectiveTestResult.find(
      subjectiveMatch,
      'testId totalScore updatedAt'
    ).lean();

    let subjectiveBestScore = 0;
    let subjectiveTotalAttempts = subjectiveDocs.length;
    let subjectiveAvgSum = 0;
    let subjectiveLastAttemptDate = null;
    const subjectiveTestIds = new Set();
    for (const r of subjectiveDocs) {
      subjectiveTestIds.add(String(r.testId));
      const score = Number.isFinite(r?.totalScore) ? r.totalScore : 0;
      subjectiveBestScore = Math.max(subjectiveBestScore, score);
      subjectiveAvgSum += score;
      if (r.updatedAt && (!subjectiveLastAttemptDate || new Date(r.updatedAt) > new Date(subjectiveLastAttemptDate))) {
        subjectiveLastAttemptDate = r.updatedAt;
      }
    }

    const aiswbMatch = { userId, testType: 'aiswb', submissionStatus: 'evaluated' };
    if (clientId) aiswbMatch.clientId = clientId;

    const aiswbAnswers = await UserAnswer.find(
      aiswbMatch,
      'questionId evaluation.score submittedAt'
    ).lean();

    const questionIds = [...new Set(aiswbAnswers.map((a) => String(a.questionId)))];
    let aiswbMarksEarned = 0;
    let aiswbMarksPossible = 0;
    let aiswbAnsweredCount = aiswbAnswers.length;
    let aiswbLastSubmittedAt = null;
    let aiswbBestScore = 0;
    let aiswbScoreSum = 0;
    const aiswbTestIds = new Set(); // Track unique AISWB tests

    if (questionIds.length > 0) {
      const aiswbQuestions = await AiswbQuestion.find(
        { _id: { $in: questionIds } },
        'metadata.maximumMarks testId'
      ).lean();
      
      const maxMap = new Map(aiswbQuestions.map((q) => [String(q._id), (q.metadata && q.metadata.maximumMarks) || 0]));
      
      for (const a of aiswbAnswers) {
        const max = maxMap.get(String(a.questionId)) || 0;
        const s = Number.isFinite(a?.evaluation?.score) ? a.evaluation.score : 0;
        const capped = Math.min(s, max);
        aiswbMarksPossible += max;
        aiswbMarksEarned += capped;
        aiswbBestScore = Math.max(aiswbBestScore, capped);
        aiswbScoreSum += capped;
        
        // Track unique test IDs from questions
        const question = aiswbQuestions.find(q => String(q._id) === String(a.questionId));
        if (question && question.testId) {
          aiswbTestIds.add(String(question.testId));
        }
        
        if (a.submittedAt && (!aiswbLastSubmittedAt || new Date(a.submittedAt) > new Date(aiswbLastSubmittedAt))) {
          aiswbLastSubmittedAt = a.submittedAt;
        }
      }
    }
    const aiswbPercentage = aiswbMarksPossible > 0 ? (aiswbMarksEarned / aiswbMarksPossible) * 100 : 0;
    const aiswbAveragePerAnswer = aiswbAnsweredCount > 0 ? (aiswbMarksEarned / aiswbAnsweredCount) : 0;
    const aiswbAverageScore = aiswbAnsweredCount > 0 ? (aiswbScoreSum / aiswbAnsweredCount) : 0;

    return res.json({
      success: true,
      data: {
        objective: {
          totalMarksEarned: Math.round(objectiveMarksEarnedSum * 100) / 100,
          marksPossible: Math.round(objectiveMarksPossibleSum * 100) / 100,
          percentage: Math.round(objectivePercentage * 100) / 100,
          totalAttempts: objectiveTotalAttempts,
          lastAttemptedAt: objectiveLastAttemptDate,
          totalTests: objectiveTestIds.size
        },
        subjective: {
          bestScoreOverall: Math.round(subjectiveBestScore * 100) / 100,
          totalAttempts: subjectiveTotalAttempts,
          averageScore: subjectiveTotalAttempts > 0 ? Math.round((subjectiveAvgSum / subjectiveTotalAttempts) * 100) / 100 : 0,
          totalTests: subjectiveTestIds.size,
          lastAttemptDate: subjectiveLastAttemptDate
        },
        aiswb: {
          bestScore: Math.round(aiswbBestScore * 100) / 100,
          averageScore: Math.round(aiswbAverageScore * 100) / 100,
          totalAnsweredCount: aiswbAnsweredCount,
          percentage: Math.round(aiswbPercentage * 100) / 100,
          averagePerAnswer: Math.round(aiswbAveragePerAnswer * 100) / 100,
          lastSubmittedAt: aiswbLastSubmittedAt,
          totalMarksEarned: Math.round(aiswbMarksEarned * 100) / 100,
          marksPossible: Math.round(aiswbMarksPossible * 100) / 100,
        },
      },
    });
  } catch (err) {
    console.error('getUserScoreboard error:', err);
    res.status(500).json({ success: false, message: 'Failed to build scoreboard', error: err.message });
  }
};


