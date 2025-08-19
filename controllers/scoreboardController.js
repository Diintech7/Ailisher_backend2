const mongoose = require('mongoose');
const TestResult = require('../models/TestResult');
const SubjectiveTestResult = require('../models/SubjectiveTestResult');
const UserAnswer = require('../models/UserAnswer');
const AiswbQuestion = require('../models/AiswbQuestion');

exports.getUserScoreboard = async (req, res) => {
  try {
    const { userId: rawUserId } = req.params;
    const { clientId } = req.query;

    let userId;
    try {
      userId = new mongoose.Types.ObjectId(rawUserId);
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid userId' });
    }

    const objectiveMatch = { userId, status: 'completed' };
    if (clientId) objectiveMatch.clientId = clientId;

    const objectiveDocs = await TestResult.find(
      objectiveMatch,
      'testId score attemptHistory submittedAt'
    ).lean();

    let objectiveBestScore = 0;
    let objectiveTotalAttempts = 0;
    let objectiveAvgSumAllAttempts = 0;
    let objectiveAvgCountAllAttempts = 0;
    let objectiveLastAttemptDate = null;
    const objectiveTestIds = new Set();
    for (const r of objectiveDocs) {
      objectiveTestIds.add(String(r.testId));
      const historyScores = Array.isArray(r.attemptHistory)
        ? r.attemptHistory.map((a) => (Number.isFinite(a?.score) ? a.score : null)).filter((x) => x !== null)
        : [];
      const historyDates = Array.isArray(r.attemptHistory)
        ? r.attemptHistory.map((a) => a?.submittedAt).filter(Boolean)
        : [];
      const best = historyScores.length > 0
        ? Math.max(...historyScores)
        : (Number.isFinite(r.score) ? r.score : 0);
      objectiveBestScore = Math.max(objectiveBestScore, best || 0);
      const attemptCount = historyScores.length > 0 ? historyScores.length : 1;
      objectiveTotalAttempts += attemptCount;
      // Average across all attempts (count root score as one if no history)
      if (historyScores.length > 0) {
        for (const s of historyScores) {
          objectiveAvgSumAllAttempts += s;
          objectiveAvgCountAllAttempts += 1;
        }
      } else if (Number.isFinite(r.score)) {
        objectiveAvgSumAllAttempts += r.score;
        objectiveAvgCountAllAttempts += 1;
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
    if (questionIds.length > 0) {
      const aiswbQuestions = await AiswbQuestion.find(
        { _id: { $in: questionIds } },
        'metadata.maximumMarks'
      ).lean();
      const maxMap = new Map(aiswbQuestions.map((q) => [String(q._id), (q.metadata && q.metadata.maximumMarks) || 0]));
      for (const a of aiswbAnswers) {
        const max = maxMap.get(String(a.questionId)) || 0;
        aiswbMarksPossible += max;
        const s = Number.isFinite(a?.evaluation?.score) ? a.evaluation.score : 0;
        aiswbMarksEarned += Math.min(s, max);
        if (a.submittedAt && (!aiswbLastSubmittedAt || new Date(a.submittedAt) > new Date(aiswbLastSubmittedAt))) {
          aiswbLastSubmittedAt = a.submittedAt;
        }
      }
    }
    const aiswbPercentage = aiswbMarksPossible > 0 ? (aiswbMarksEarned / aiswbMarksPossible) * 100 : 0;
    const aiswbAveragePerAnswer = aiswbAnsweredCount > 0 ? (aiswbMarksEarned / aiswbAnsweredCount) : 0;

    return res.json({
      success: true,
      data: {
        objective: {
          bestScoreOverall: Math.round(objectiveBestScore * 100) / 100,
          totalAttempts: objectiveTotalAttempts,
          averageScoreAcrossAttempts: objectiveAvgCountAllAttempts > 0 ? Math.round((objectiveAvgSumAllAttempts / objectiveAvgCountAllAttempts) * 100) / 100 : 0,
          totalTests: objectiveTestIds.size,
          lastAttemptDate: objectiveLastAttemptDate
        },
        subjective: {
          bestScoreOverall: Math.round(subjectiveBestScore * 100) / 100,
          totalAttempts: subjectiveTotalAttempts,
          averageScore: subjectiveTotalAttempts > 0 ? Math.round((subjectiveAvgSum / subjectiveTotalAttempts) * 100) / 100 : 0,
          totalTests: subjectiveTestIds.size,
          lastAttemptDate: subjectiveLastAttemptDate
        },
        aiswb: {
          marksEarned: Math.round(aiswbMarksEarned * 100) / 100,
          marksPossible: Math.round(aiswbMarksPossible * 100) / 100,
          percentage: Math.round(aiswbPercentage * 100) / 100,
          answeredCount: aiswbAnsweredCount,
          averagePerAnswer: Math.round(aiswbAveragePerAnswer * 100) / 100,
          lastSubmittedAt: aiswbLastSubmittedAt
        },
      },
    });
  } catch (err) {
    console.error('getUserScoreboard error:', err);
    res.status(500).json({ success: false, message: 'Failed to build scoreboard', error: err.message });
  }
};


