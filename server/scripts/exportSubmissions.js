/* eslint-disable no-console */
// Anonymous export of learner code submissions for the pilot analysis.
//
// Submissions are stored in DynamoDB under an opaque Mongo ObjectId. This script
// replaces that ID with a stable `learner-NN` token and, by default, writes only:
//
//   submissions-<date>.json   the research dataset — tokens only, no identity
//
// Without a token->userId mapping the dataset cannot be traced to any person,
// so the default output is anonymous rather than merely pseudonymous. This
// costs the analysis nothing: tokens still link one learner's attempts to each
// other, which is all the trajectory and before/after-hint comparisons need.
// The mapping is only required to identify a specific student, and is therefore
// opt-in:
//
//   --with-key   also write submissions-<date>.key.json (re-identification key)
//
// Pass it only if you have a concrete reason to re-identify — e.g. joining
// submissions to a named learner's SUS response. That output IS personal data:
// store it apart from the dataset and delete it when you are done.
//
// Tokens are assigned by sorted userId, so repeated exports over the same
// cohort produce the same token for the same learner.
//
// Lesson titles are resolved from MongoDB so the dataset is readable without a
// second join. No learner names, emails or Cognito IDs are ever written.
//
// Usage (from /server):
//   node scripts/exportSubmissions.js                  # -> ./exports/, anonymous
//   node scripts/exportSubmissions.js --out ./somewhere
//   node scripts/exportSubmissions.js --lesson <lessonId>   # single lesson
//   node scripts/exportSubmissions.js --with-key            # + key file

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const { env } = require('../src/config/env');
const { maskMongoUri } = require('../src/utils/maskUri');
const { Lesson } = require('../src/models/Lesson');
const progressTable = require('../src/dynamo/progressTable');

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

const outDir = path.resolve(argValue('--out') || path.join(__dirname, '..', 'exports'));
const lessonFilter = argValue('--lesson');
const withKey = process.argv.includes('--with-key');

// Sorted assignment keeps a learner's token stable across re-runs.
const buildTokenMap = (records) => {
  const userIds = [...new Set(records.map((r) => r.userId))].sort();
  const width = String(userIds.length).length;
  return new Map(
    userIds.map((id, i) => [id, `learner-${String(i + 1).padStart(width, '0')}`]),
  );
};

const run = async () => {
  await mongoose.connect(env.mongoUri);
  console.log(`Connected to ${maskMongoUri(env.mongoUri)}`);

  const all = await progressTable.scanAll();
  const records = lessonFilter ? all.filter((r) => r.lessonId === lessonFilter) : all;
  console.log(`Read ${all.length} progress record(s); ${records.length} in scope.`);

  if (records.length === 0) {
    console.log('Nothing to export.');
    await mongoose.disconnect();
    return;
  }

  const tokens = buildTokenMap(records);

  const lessons = await Lesson.find({ _id: { $in: [...new Set(records.map((r) => r.lessonId))] } })
    .select('title type language')
    .lean();
  const lessonById = Object.fromEntries(lessons.map((l) => [l._id.toString(), l]));

  const rows = [];
  for (const record of records) {
    const lesson = lessonById[record.lessonId] || {};
    (record.codeSubmissions || []).forEach((submission, i) => {
      rows.push({
        learner: tokens.get(record.userId),
        lessonId: record.lessonId,
        lessonTitle: lesson.title || null,
        lessonType: lesson.type || null,
        language: lesson.language || null,
        attemptIndex: i + 1,
        passed: Boolean(submission.passed),
        // Hints revealed at the moment of this attempt — pair consecutive rows
        // to see whether a reveal changed what the learner wrote next.
        hintsUsedAtSubmit: submission.hintsUsedAtSubmit ?? null,
        code: submission.code ?? null,
        stdout: submission.stdout ?? null,
        error: submission.error ?? null,
        submittedAt: submission.submittedAt || null,
      });
    });
  }

  rows.sort(
    (a, b) =>
      a.learner.localeCompare(b.learner) ||
      a.lessonId.localeCompare(b.lessonId) ||
      a.attemptIndex - b.attemptIndex,
  );

  const stamp = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(outDir, { recursive: true });
  const dataPath = path.join(outDir, `submissions-${stamp}.json`);

  fs.writeFileSync(
    dataPath,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        learnerCount: tokens.size,
        submissionCount: rows.length,
        note: withKey
          ? 'Pseudonymised — re-identifiable via the separate .key.json file emitted alongside this export.'
          : 'Anonymous — learner tokens are internal to this file and no mapping to any identity was written.',
        submissions: rows,
      },
      null,
      2,
    ),
  );

  console.log(`  dataset: ${dataPath}`);

  if (withKey) {
    const keyPath = path.join(outDir, `submissions-${stamp}.key.json`);
    fs.writeFileSync(
      keyPath,
      JSON.stringify(
        {
          warning:
            'RE-IDENTIFICATION KEY — personal data. Store separately from the dataset, never commit, delete when analysis no longer needs it.',
          exportedAt: new Date().toISOString(),
          tokenToUserId: Object.fromEntries([...tokens].map(([userId, token]) => [token, userId])),
        },
        null,
        2,
      ),
    );
    console.log(`      key: ${keyPath}  (personal data — store separately, do not commit)`);
  } else {
    console.log('      key: not written (anonymous export; pass --with-key if you need one)');
  }

  console.log(`${rows.length} submission(s) from ${tokens.size} learner(s).`);

  await mongoose.disconnect();
  console.log('Done.');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
