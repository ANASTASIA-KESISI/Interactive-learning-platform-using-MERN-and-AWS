/* eslint-disable no-console */
// One-shot seeder for the pilot's institution tree (S7 D3). Idempotent —
// universities upsert by `code` and departments by (universityId, code), so
// re-running is safe after a Mongo reset and adding a department here and
// re-running is the supported way to extend the tree without the admin panel.
//
// Usage (from /server):
//   node scripts/seedUniversities.js
//
// Reads MONGODB_URI from server/.env via the same env loader as the app.

const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { maskMongoUri } = require('../src/utils/maskUri');
const { University } = require('../src/models/University');
const { Department } = require('../src/models/Department');

// semesterCount drives the "Semester 1 … N" sections on the Courses page, so
// it must match the department's actual programme length — Music Science & Art
// runs ten semesters, the rest eight.
const UNIVERSITIES = [
  {
    name: 'University of Macedonia',
    code: 'UOM',
    departments: [
      { name: 'Applied Informatics', code: 'AI', semesterCount: 8 },
      { name: 'Business Administration', code: 'BA', semesterCount: 8 },
      { name: 'Economics', code: 'ECO', semesterCount: 8 },
      { name: 'International & European Studies', code: 'IES', semesterCount: 8 },
      { name: 'Accounting & Finance', code: 'AF', semesterCount: 8 },
      { name: 'Educational & Social Policy', code: 'ESP', semesterCount: 8 },
      { name: 'Music Science & Art', code: 'MSA', semesterCount: 10 },
      { name: 'Balkan Slavic & Oriental Studies', code: 'BSO', semesterCount: 8 },
    ],
  },
];

const seed = async () => {
  await mongoose.connect(env.mongoUri);
  console.log(`Connected to ${maskMongoUri(env.mongoUri)}`);

  for (const { departments, ...university } of UNIVERSITIES) {
    const result = await University.updateOne(
      { code: university.code },
      { $set: university },
      { upsert: true },
    );
    console.log(`  ${result.upsertedCount ? 'created' : 'updated'}: ${university.name}`);

    const doc = await University.findOne({ code: university.code });

    for (const department of departments) {
      const depResult = await Department.updateOne(
        { universityId: doc._id, code: department.code },
        { $set: { ...department, universityId: doc._id } },
        { upsert: true },
      );
      console.log(
        `    ${depResult.upsertedCount ? 'created' : 'updated'}: ${department.name} ` +
          `(${department.semesterCount} semesters)`,
      );
    }
  }

  await mongoose.disconnect();
  console.log('Done.');
};

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
