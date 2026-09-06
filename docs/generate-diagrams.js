#!/usr/bin/env node
//
// Generates the architecture diagrams from one description of the layout.
//
//   node docs/generate-diagrams.js
//
// Outputs, all into docs/:
//   learncode-architecture.drawio   editable source, three pages, open in draw.io
//   data-model-people.svg           figure 1
//   data-model-content.svg          figure 2
//   aws-topology.svg                figure 3
//
// PNGs are produced from the SVGs by rasterising them; see docs/README.md.
//
// Why a generator rather than a hand-drawn file: a swimlane's height must equal
// its header plus its rows or the last field renders outside the box, and there
// are ~130 of those rows. And because the .drawio and the SVGs must not drift,
// both are emitted from the same data below.

'use strict';

const fs = require('fs');
const path = require('path');

const OUT_DIR = __dirname;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const HEADER = 26;
const ROW = 20;

const C = {
  mongo: '#dae8fc',
  mongoStroke: '#6c8ebf',
  dynamo: '#ffe6cc',
  dynamoStroke: '#d79b00',
  stub: '#f0f0f0',
  stubStroke: '#b3b3b3',
  green: '#d5e8d4',
  greenStroke: '#82b366',
  purple: '#e1d5e7',
  purpleStroke: '#9673a6',
  grey: '#f5f5f5',
  greyStroke: '#666666',
  ink: '#333333',
  line: '#4d4d4d',
};

// ── Field lists ──────────────────────────────────────────────────────────────
const F = {
  university: ['_id : ObjectId  PK', 'name : String', 'code : String  unique'],
  department: [
    '_id : ObjectId  PK', 'universityId : ObjectId  FK', 'name : String',
    'code : String', 'semesterCount : Number  1-12',
  ],
  badge: [
    '_id : ObjectId  PK', 'name : String  unique', 'description : String',
    'icon : String  /badges/*.svg', 'criteria.type : enum  7 types',
    'criteria.threshold : Number', 'xpValue : Number',
  ],
  user: [
    '_id : ObjectId  PK', 'cognitoId : String  unique', 'email : String  unique',
    'firstName : String', 'lastName : String', 'role : enum  student|instructor|admin',
    'avatar : String', 'bio : String', 'universityId : ObjectId  FK',
    'departmentId : ObjectId  FK', 'enrolledCourses : ObjectId[]  FK',
    'badges : ObjectId[]  FK', 'xpPoints : Number', 'streak : Number',
    'lessonsCompleted : Number', 'unaidedCompletions : Number',
    'quizzesPassed : Number', 'coursesCompleted : Number', 'notesWritten : Number',
    'lastActiveAt : Date', 'lastCompletionAt : Date',
  ],
  course: [
    '_id : ObjectId  PK', 'title : String', 'description : String',
    'instructor : ObjectId  FK User', 'category : String', 'difficulty : enum',
    'departmentId : ObjectId  FK', 'semester : Number  1-12',
    'about : String  Markdown', 'icon : String', 'modules : ObjectId[]  FK',
    'enrollmentCount : Number', 'isPublished : Boolean',
  ],
  module: [
    '_id : ObjectId  PK', 'courseId : ObjectId  FK', 'title : String',
    'order : Number', 'lessons : ObjectId[]  FK',
  ],
  lesson: [
    '_id : ObjectId  PK', 'moduleId : ObjectId  FK', 'title : String',
    'type : enum  tutorial|exercise|quiz', 'language : enum  javascript|python',
    'content : String  Markdown', 'task : String', 'codeTemplate : String',
    'expectedOutput : String  never sent', 'hints : String[]  never sent',
    'questions : Object[]  quiz only', 'passMark : Number', 'order : Number',
    'xpReward : Number',
  ],
  note: [
    '_id : ObjectId  PK', 'userId : ObjectId  FK', 'scope : enum  lesson|module',
    'targetId : ObjectId', 'courseId : ObjectId  FK', 'moduleId : ObjectId  FK',
    'lessonId : ObjectId  FK', 'body : String  plain text',
  ],
  message: [
    '_id : ObjectId  PK', 'courseId : ObjectId  FK', 'studentId : ObjectId  FK',
    'instructorId : ObjectId  FK', 'senderId : ObjectId  FK', 'senderRole : enum',
    'lessonId : ObjectId  FK', 'body : String  plain text', 'readAt : Date',
  ],
  progress: [
    'userId : String  PARTITION KEY', 'lessonId : String  SORT KEY',
    'status : in_progress|completed', 'attempts : Number  submits only',
    'score : Number', 'timeSpent : Number  seconds', 'hintsUsed : Number',
    'codeSubmissions : Object[]  capped', 'startedAt : ISO String',
    'completedAt : ISO String', 'runs : Number', 'questionsAsked : Number',
    'noteUpdatedAt : ISO String',
  ],
};

const h = (e) => HEADER + e.fields.length * ROW;

// ── Page definitions ─────────────────────────────────────────────────────────
const PAGE_PEOPLE = {
  id: 'data-people',
  name: '1. Data model — people',
  file: 'data-model-people',
  title: 'LearnCode data model — people and institution',
  w: 1080,
  h: 570,
  entities: [
    { id: 'university', title: 'University', sub: 'universities', x: 40, y: 60, w: 250, fields: F.university },
    { id: 'department', title: 'Department', sub: 'departments', x: 40, y: 195, w: 250, fields: F.department },
    { id: 'badge', title: 'Badge', sub: 'badges', x: 40, y: 370, w: 250, fields: F.badge },
    { id: 'user', title: 'User', sub: 'users', x: 390, y: 60, w: 290, fields: F.user },
    {
      id: 'course_stub', title: 'Course', sub: 'detail in figure 2', x: 790, y: 170, w: 230,
      stub: true, fields: ['_id : ObjectId  PK', 'instructor : ObjectId  FK', 'departmentId : ObjectId  FK'],
    },
  ],
  rels: [
    { from: 'university', to: 'department', label: 'has 1..N' },
    { from: 'department', to: 'user', label: 'places 1..N' },
    { from: 'badge', to: 'user', label: 'earns N..N' },
    { from: 'user', to: 'course_stub', label: 'teaches 1..N', sy: 0.25, ty: 0.25 },
    { from: 'user', to: 'course_stub', label: 'enrols N..N', sy: 0.75, ty: 0.75 },
  ],
  legend: {
    x: 790, y: 400,
    rows: [
      ['MongoDB Atlas — content and user state', C.mongo, C.mongoStroke, false],
      ['stub — full definition in figure 2', C.stub, C.stubStroke, true],
    ],
  },
};

const PAGE_CONTENT = {
  id: 'data-content',
  name: '2. Data model — content',
  file: 'data-model-content',
  title: 'LearnCode data model — content and progress',
  w: 1460,
  h: 860,
  entities: [
    {
      id: 'dept_stub', title: 'Department', sub: 'detail in figure 1', x: 40, y: 60, w: 230,
      stub: true, fields: ['_id : ObjectId  PK', 'semesterCount : Number'],
    },
    { id: 'course', title: 'Course', sub: 'courses', x: 40, y: 190, w: 280, fields: F.course },
    {
      // Below Lesson rather than in the left column: from the left its edges to
      // Note, Message and progress would run straight through the Lesson box.
      id: 'user_stub', title: 'User', sub: 'detail in figure 1', x: 410, y: 720, w: 280,
      stub: true, fields: ['_id : ObjectId  PK', 'role : enum'],
    },
    { id: 'module', title: 'Module', sub: 'modules', x: 410, y: 190, w: 280, fields: F.module },
    { id: 'lesson', title: 'Lesson', sub: 'lessons', x: 410, y: 380, w: 280, fields: F.lesson },
    { id: 'note', title: 'Note', sub: 'notes', x: 830, y: 60, w: 270, fields: F.note },
    { id: 'message', title: 'Message', sub: 'messages', x: 830, y: 300, w: 270, fields: F.message },
    {
      id: 'progress', title: 'progress', sub: 'DynamoDB  learncode_progress', x: 830, y: 550, w: 270,
      dynamo: true, fields: F.progress,
    },
  ],
  rels: [
    { from: 'dept_stub', to: 'course', label: 'owns 1..N' },
    { from: 'course', to: 'module', label: 'ordered 1..N' },
    { from: 'module', to: 'lesson', label: 'ordered 1..N' },
    // `mx` spreads the elbows across the gutter so five edges sharing it do not
    // stack into one vertical line.
    { from: 'lesson', to: 'note', label: 'notes 0..N', sy: 0.12, mx: 0.25 },
    { from: 'user_stub', to: 'note', label: 'writes 1..N', sy: 0.3, mx: 0.45 },
    { from: 'course', to: 'message', label: 'thread 1..N', sy: 0.9 },
    { from: 'user_stub', to: 'message', label: 'sends 1..N', sy: 0.55, mx: 0.62 },
    { from: 'user_stub', to: 'progress', label: 'userId — no FK', dashed: true, colour: C.dynamoStroke, sy: 0.8, mx: 0.8 },
    { from: 'lesson', to: 'progress', label: 'lessonId — no FK', dashed: true, colour: C.dynamoStroke, sy: 0.9, mx: 0.12 },
  ],
  legend: {
    x: 1150, y: 60,
    rows: [
      ['MongoDB Atlas — content', C.mongo, C.mongoStroke, false],
      ['DynamoDB — high-throughput events', C.dynamo, C.dynamoStroke, false],
      ['stub — full definition in figure 1', C.stub, C.stubStroke, true],
      ['dashed — id carried across stores', '#ffffff', C.dynamoStroke, true],
    ],
  },
};

const PAGE_AWS = {
  id: 'aws',
  name: '3. AWS topology',
  file: 'aws-topology',
  title: 'LearnCode — AWS deployment topology',
  w: 1280,
  h: 790,
  group: { x: 300, y: 50, w: 940, h: 700, label: 'AWS account — region eu-west-1', stroke: '#ff9900' },
  boxes: [
    { id: 'browser', x: 40, y: 150, w: 200, h: 70, fill: C.grey, stroke: C.greyStroke,
      lines: ['Browser', 'student · instructor · admin'] },
    { id: 'amplify', x: 330, y: 90, w: 240, h: 90, fill: C.green, stroke: C.greenStroke,
      lines: ['AWS Amplify Hosting', 'React SPA (Vite build)', 'branch dev, builds on push'] },
    { id: 'cloudfront', x: 330, y: 280, w: 240, h: 100, fill: C.mongo, stroke: C.mongoStroke,
      lines: ['CloudFront', 'HTTPS for the API', 'CachingDisabled +', 'AllViewerExceptHostHeader'] },
    { id: 'cognito', x: 330, y: 460, w: 240, h: 90, fill: C.purple, stroke: C.purpleStroke,
      lines: ['Cognito User Pool', 'groups student | instructor | admin', 'issues the JWT the API verifies'] },
    { id: 'ec2', x: 630, y: 280, w: 290, h: 100, fill: C.dynamo, stroke: C.dynamoStroke,
      lines: ['EC2 t3.micro — learncode-api', 'Amazon Linux 2023, Elastic IP', 'nginx :80  →  node :4000', 'systemd unit learncode-api'] },
    { id: 'lambda', x: 980, y: 90, w: 240, h: 110, fill: C.dynamo, stroke: C.dynamoStroke,
      lines: ['Lambda code runners', 'learncode-runner-js (Node.js)', 'learncode-runner-py (Python)', 'credentials scrubbed per call'] },
    { id: 'dynamo', x: 980, y: 260, w: 240, h: 100, fill: C.dynamo, stroke: C.dynamoStroke,
      lines: ['DynamoDB — learncode_progress', 'PK userId · SK lessonId', 'on-demand, encrypted at rest'] },
    { id: 's3', x: 980, y: 420, w: 240, h: 60, fill: C.dynamo, stroke: C.dynamoStroke,
      lines: ['S3 — learncode-media', 'media and static assets'] },
    { id: 'cw', x: 980, y: 530, w: 240, h: 70, fill: C.dynamo, stroke: C.dynamoStroke,
      lines: ['CloudWatch Logs', 'structured JSON request logs'] },
    { id: 'atlas', x: 330, y: 620, w: 240, h: 80, fill: C.green, stroke: C.greenStroke,
      lines: ['MongoDB Atlas', 'database learncode', 'content + user state'] },
    { id: 'gh', x: 40, y: 460, w: 200, h: 70, fill: C.grey, stroke: C.greyStroke,
      lines: ['GitHub Actions', 'lint + test gate, then deploy'] },
    { id: 'oidc', x: 630, y: 450, w: 290, h: 70, fill: C.purple, stroke: C.purpleStroke,
      lines: ['IAM role learncode-github-deploy', 'assumed via GitHub OIDC', '(no stored AWS keys)'] },
    { id: 'ssm', x: 630, y: 560, w: 290, h: 55, fill: C.purple, stroke: C.purpleStroke,
      lines: ['SSM Run Command', 'deploy/update-ec2.sh'] },
    { id: 'ec2role', x: 630, y: 650, w: 290, h: 70, fill: C.purple, stroke: C.purpleStroke,
      lines: ['IAM role learncode-ec2-role', 'lambda:InvokeFunction scoped', 'to explicit function ARNs'] },
  ],
  arrows: [
    { from: 'browser', to: 'amplify', label: 'HTTPS  app' },
    { from: 'browser', to: 'cloudfront', label: 'HTTPS  /api' },
    { from: 'browser', to: 'cognito', label: 'sign-in, JWT' },
    { from: 'cloudfront', to: 'ec2', label: 'HTTP :80' },
    { from: 'ec2', to: 'atlas', label: 'TLS' },
    { from: 'ec2', to: 'dynamo', label: 'SDK' },
    { from: 'ec2', to: 'lambda', label: 'Invoke' },
    { from: 'ec2', to: 's3', label: 'SDK' },
    { from: 'ec2', to: 'cw', label: 'logs' },
    { from: 'ec2', to: 'cognito', label: 'verify JWT', dashed: true },
    { from: 'gh', to: 'oidc', label: 'assume role', dashed: true },
    { from: 'oidc', to: 'ssm', label: '', dashed: true },
    { from: 'ssm', to: 'ec2', label: 'pull + restart', dashed: true },
    { from: 'gh', to: 'amplify', label: 'triggers build', dashed: true },
    { from: 'ec2role', to: 'ec2', label: 'attached', dashed: true },
  ],
};

const DATA_PAGES = [PAGE_PEOPLE, PAGE_CONTENT];
const ALL_PAGES = [PAGE_PEOPLE, PAGE_CONTENT, PAGE_AWS];

// ── .drawio emitter ──────────────────────────────────────────────────────────
const drawioEntity = (e) => {
  const out = [];
  const fill = e.stub ? C.stub : e.dynamo ? C.dynamo : C.mongo;
  const stroke = e.stub ? C.stubStroke : e.dynamo ? C.dynamoStroke : C.mongoStroke;
  out.push(
    `        <mxCell id="${e.id}" value="${esc(`${e.title}\n${e.sub}`)}" style="swimlane;html=1;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=${HEADER};horizontalStack=0;resizeParent=0;resizeLast=0;collapsible=0;marginBottom=0;whiteSpace=wrap;fillColor=${fill};strokeColor=${stroke};align=center;verticalAlign=middle;fontSize=12;${e.stub ? 'dashed=1;fontColor=#666666;' : ''}" vertex="1" parent="1">\n` +
      `          <mxGeometry x="${e.x}" y="${e.y}" width="${e.w}" height="${h(e)}" as="geometry" />\n        </mxCell>`,
  );
  e.fields.forEach((f, i) => {
    const key = /PK|PARTITION KEY|SORT KEY/.test(f);
    out.push(
      `        <mxCell id="${e.id}-f${i}" value="${esc(f)}" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=6;spacingRight=6;overflow=hidden;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;rotatable=0;whiteSpace=wrap;fontSize=11;${key ? 'fontStyle=1;' : ''}${e.stub ? 'fontColor=#666666;' : ''}" vertex="1" parent="${e.id}">\n` +
        `          <mxGeometry y="${HEADER + i * ROW}" width="${e.w}" height="${ROW}" as="geometry" />\n        </mxCell>`,
    );
  });
  return out;
};

const drawioPage = (p) => {
  const cells = [];
  cells.push(
    `        <mxCell id="${p.id}-title" value="${esc(p.title)}" style="text;html=1;fontSize=16;fontStyle=1;align=left;verticalAlign=middle;strokeColor=none;fillColor=none;" vertex="1" parent="1">\n          <mxGeometry x="40" y="14" width="700" height="30" as="geometry" />\n        </mxCell>`,
  );
  if (p.group) {
    cells.push(
      `        <mxCell id="${p.id}-group" value="${esc(p.group.label)}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=${p.group.stroke};dashed=1;verticalAlign=top;align=left;spacingLeft=8;spacingTop=4;fontSize=11;fontStyle=2;" vertex="1" parent="1">\n          <mxGeometry x="${p.group.x}" y="${p.group.y}" width="${p.group.w}" height="${p.group.h}" as="geometry" />\n        </mxCell>`,
    );
  }
  (p.entities || []).forEach((e) => cells.push(...drawioEntity(e)));
  (p.boxes || []).forEach((b) =>
    cells.push(
      `        <mxCell id="${b.id}" value="${esc(b.lines.join('\n'))}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=${b.fill};strokeColor=${b.stroke};align=center;verticalAlign=middle;fontSize=11;" vertex="1" parent="1">\n          <mxGeometry x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" as="geometry" />\n        </mxCell>`,
    ),
  );
  (p.rels || []).forEach((r, i) =>
    cells.push(
      `        <mxCell id="${p.id}-r${i}" value="${esc(r.label)}" style="edgeStyle=entityRelationEdgeStyle;html=1;rounded=0;exitX=1;exitY=${r.sy ?? 0.5};entryX=0;entryY=${r.ty ?? 0.5};fontSize=10;endArrow=ERmany;startArrow=ERone;strokeColor=${r.colour || C.line};${r.dashed ? 'dashed=1;' : ''}" edge="1" parent="1" source="${r.from}" target="${r.to}">\n          <mxGeometry relative="1" as="geometry" />\n        </mxCell>`,
    ),
  );
  (p.arrows || []).forEach((a, i) =>
    cells.push(
      `        <mxCell id="${p.id}-a${i}" value="${esc(a.label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;fontSize=10;${a.dashed ? 'dashed=1;' : ''}" edge="1" parent="1" source="${a.from}" target="${a.to}">\n          <mxGeometry relative="1" as="geometry" />\n        </mxCell>`,
    ),
  );
  if (p.legend) {
    const L = p.legend;
    cells.push(
      `        <mxCell id="${p.id}-legend" value="Legend" style="swimlane;html=1;fontStyle=1;startSize=26;collapsible=0;fillColor=#f9f9f9;strokeColor=#999999;whiteSpace=wrap;fontSize=11;" vertex="1" parent="1">\n          <mxGeometry x="${L.x}" y="${L.y}" width="270" height="${26 + L.rows.length * 24}" as="geometry" />\n        </mxCell>`,
    );
    L.rows.forEach(([text, fill, stroke, dashed], i) => {
      cells.push(
        `        <mxCell id="${p.id}-lt${i}" value="${esc(text)}" style="text;html=1;align=left;verticalAlign=middle;spacingLeft=24;fontSize=10;fillColor=none;strokeColor=none;" vertex="1" parent="${p.id}-legend">\n          <mxGeometry y="${26 + i * 24}" width="270" height="24" as="geometry" />\n        </mxCell>`,
        `        <mxCell id="${p.id}-ls${i}" value="" style="rounded=0;html=1;fillColor=${fill};strokeColor=${stroke};${dashed ? 'dashed=1;' : ''}" vertex="1" parent="${p.id}-legend">\n          <mxGeometry x="6" y="${33 + i * 24}" width="13" height="10" as="geometry" />\n        </mxCell>`,
      );
    });
  }
  return (
    `  <diagram id="${p.id}" name="${esc(p.name)}">\n` +
    `    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${p.w}" pageHeight="${p.h}" math="0" shadow="0">\n` +
    `      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n${cells.join('\n')}\n      </root>\n` +
    `    </mxGraphModel>\n  </diagram>`
  );
};

// ── SVG emitter ──────────────────────────────────────────────────────────────
const FONT = "system-ui, 'Segoe UI', Roboto, Arial, sans-serif";
const textWidth = (s, size) => s.length * size * 0.55;

// A label centred on the elbow lands on top of a box whenever the gutter is
// narrower than the text. Anchoring it to the line just after it leaves the
// source keeps it in open space regardless of how tight the columns are.
const svgLabel = (x, y, text, colour, anchor = 'middle') => {
  if (!text) return '';
  const w = textWidth(text, 10) + 8;
  const rx = anchor === 'start' ? x - 4 : x - w / 2;
  return (
    `  <rect x="${rx.toFixed(1)}" y="${(y - 8).toFixed(1)}" width="${w.toFixed(1)}" height="14" fill="#ffffff" opacity="0.92"/>\n` +
    `  <text x="${x.toFixed(1)}" y="${(y + 2).toFixed(1)}" font-family="${FONT}" font-size="10" fill="${colour}" text-anchor="${anchor}">${esc(text)}</text>`
  );
};

const svgEntity = (e) => {
  const fill = e.stub ? C.stub : e.dynamo ? C.dynamo : C.mongo;
  const stroke = e.stub ? C.stubStroke : e.dynamo ? C.dynamoStroke : C.mongoStroke;
  const fg = e.stub ? '#666666' : C.ink;
  const H = h(e);
  const out = [
    `  <g>`,
    `    <rect x="${e.x}" y="${e.y}" width="${e.w}" height="${H}" fill="#ffffff" stroke="${stroke}" stroke-width="1.4"${e.stub ? ' stroke-dasharray="5 3"' : ''}/>`,
    `    <rect x="${e.x}" y="${e.y}" width="${e.w}" height="${HEADER}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"${e.stub ? ' stroke-dasharray="5 3"' : ''}/>`,
    `    <text x="${e.x + e.w / 2}" y="${e.y + 12}" font-family="${FONT}" font-size="12" font-weight="600" fill="${fg}" text-anchor="middle">${esc(e.title)}</text>`,
    `    <text x="${e.x + e.w / 2}" y="${e.y + 22}" font-family="${FONT}" font-size="9" fill="${e.stub ? '#888888' : '#5a6b7d'}" text-anchor="middle">${esc(e.sub)}</text>`,
  ];
  e.fields.forEach((f, i) => {
    const y = e.y + HEADER + i * ROW;
    const key = /PK|PARTITION KEY|SORT KEY/.test(f);
    if (i > 0) out.push(`    <line x1="${e.x}" y1="${y}" x2="${e.x + e.w}" y2="${y}" stroke="#e6e6e6" stroke-width="0.8"/>`);
    out.push(
      `    <text x="${e.x + 7}" y="${y + 14}" font-family="${FONT}" font-size="10.5" fill="${fg}"${key ? ' font-weight="600"' : ''}>${esc(f)}</text>`,
    );
  });
  out.push('  </g>');
  return out.join('\n');
};

// Horizontal elbow when the target is clear to the right; vertical elbow when it
// is clear below. Those two cases cover every relationship in these layouts —
// the layouts were arranged so they would.
const relPath = (s, t, r) => {
  const sh = h(s);
  const th = h(t);
  if (t.x >= s.x + s.w) {
    const sy = s.y + sh * (r.sy ?? 0.5);
    const ty = t.y + th * (r.ty ?? 0.5);
    const gutterStart = s.x + s.w;
    const mid = gutterStart + (t.x - gutterStart) * (r.mx ?? 0.5);
    return { d: `M ${s.x + s.w} ${sy} H ${mid} V ${ty} H ${t.x}`, lx: s.x + s.w + 6, ly: sy - 6, anchor: 'start', arrow: [t.x, ty, 'right'] };
  }
  const sx = s.x + s.w / 2;
  const tx = t.x + t.w / 2;
  const mid = (s.y + sh + t.y) / 2;
  return { d: `M ${sx} ${s.y + sh} V ${mid} H ${tx} V ${t.y}`, lx: sx + 6, ly: s.y + sh + 14, anchor: 'start', arrow: [tx, t.y, 'down'] };
};

const arrowHead = (x, y, dir, colour) => {
  const p =
    dir === 'right'
      ? `${x},${y} ${x - 9},${y - 4.5} ${x - 9},${y + 4.5}`
      : `${x},${y} ${x - 4.5},${y - 9} ${x + 4.5},${y - 9}`;
  return `  <polygon points="${p}" fill="${colour}"/>`;
};

// Straight edge-to-edge for the topology page: elbows there would run through
// the boxes, and a topology diagram reads fine with direct lines.
const boxEdgePoint = (b, tx, ty) => {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  const sx = dx === 0 ? Infinity : b.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : b.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
};

const svgPage = (p) => {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${p.w} ${p.h}" width="${p.w}" height="${p.h}">`,
    `  <rect width="${p.w}" height="${p.h}" fill="#ffffff"/>`,
    `  <text x="40" y="34" font-family="${FONT}" font-size="17" font-weight="600" fill="${C.ink}">${esc(p.title)}</text>`,
  ];

  if (p.group) {
    parts.push(
      `  <rect x="${p.group.x}" y="${p.group.y}" width="${p.group.w}" height="${p.group.h}" fill="none" stroke="${p.group.stroke}" stroke-width="1.4" stroke-dasharray="6 4"/>`,
      `  <text x="${p.group.x + 10}" y="${p.group.y + 16}" font-family="${FONT}" font-size="11" font-style="italic" fill="${p.group.stroke}">${esc(p.group.label)}</text>`,
    );
  }

  const byId = {};
  (p.entities || []).forEach((e) => (byId[e.id] = e));
  (p.boxes || []).forEach((b) => (byId[b.id] = b));

  // Edges first so the shapes sit on top of the line ends.
  (p.rels || []).forEach((r) => {
    const s = byId[r.from];
    const t = byId[r.to];
    const colour = r.colour || C.line;
    const { d, lx, ly, anchor, arrow } = relPath(s, t, r);
    parts.push(
      `  <path d="${d}" fill="none" stroke="${colour}" stroke-width="1.3"${r.dashed ? ' stroke-dasharray="6 4"' : ''}/>`,
      arrowHead(arrow[0], arrow[1], arrow[2], colour),
      svgLabel(lx, ly, r.label, colour, anchor),
    );
  });

  (p.arrows || []).forEach((a) => {
    const s = byId[a.from];
    const t = byId[a.to];
    const sc = [s.x + s.w / 2, s.y + s.h / 2];
    const tc = [t.x + t.w / 2, t.y + t.h / 2];
    const [x1, y1] = boxEdgePoint(s, tc[0], tc[1]);
    const [x2, y2] = boxEdgePoint(t, sc[0], sc[1]);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const hx = x2 - Math.cos(ang) * 9;
    const hy = y2 - Math.sin(ang) * 9;
    const nx = -Math.sin(ang) * 4.5;
    const ny = Math.cos(ang) * 4.5;
    parts.push(
      `  <line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="${C.line}" stroke-width="1.3"${a.dashed ? ' stroke-dasharray="6 4"' : ''}/>`,
      `  <polygon points="${x2.toFixed(1)},${y2.toFixed(1)} ${(hx + nx).toFixed(1)},${(hy + ny).toFixed(1)} ${(hx - nx).toFixed(1)},${(hy - ny).toFixed(1)}" fill="${C.line}"/>`,
      svgLabel((x1 + x2) / 2, (y1 + y2) / 2, a.label, C.line),
    );
  });

  (p.entities || []).forEach((e) => parts.push(svgEntity(e)));

  (p.boxes || []).forEach((b) => {
    parts.push(
      `  <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="${b.fill}" stroke="${b.stroke}" stroke-width="1.4"/>`,
    );
    const startY = b.y + b.h / 2 - ((b.lines.length - 1) * 13) / 2 + 4;
    b.lines.forEach((ln, i) =>
      parts.push(
        `  <text x="${b.x + b.w / 2}" y="${startY + i * 13}" font-family="${FONT}" font-size="${i === 0 ? 11.5 : 10}" font-weight="${i === 0 ? 600 : 400}" fill="${C.ink}" text-anchor="middle">${esc(ln)}</text>`,
      ),
    );
  });

  if (p.legend) {
    const L = p.legend;
    const lh = 26 + L.rows.length * 24;
    parts.push(
      `  <rect x="${L.x}" y="${L.y}" width="270" height="${lh}" fill="#f9f9f9" stroke="#999999" stroke-width="1.2"/>`,
      `  <text x="${L.x + 135}" y="${L.y + 17}" font-family="${FONT}" font-size="11" font-weight="600" fill="${C.ink}" text-anchor="middle">Legend</text>`,
    );
    L.rows.forEach(([text, fill, stroke, dashed], i) => {
      const y = L.y + 26 + i * 24;
      parts.push(
        `  <rect x="${L.x + 8}" y="${y + 7}" width="13" height="10" fill="${fill}" stroke="${stroke}" stroke-width="1.2"${dashed ? ' stroke-dasharray="3 2"' : ''}/>`,
        `  <text x="${L.x + 28}" y="${y + 16}" font-family="${FONT}" font-size="10" fill="${C.ink}">${esc(text)}</text>`,
      );
    });
  }

  parts.push('</svg>');
  return parts.join('\n');
};

// ── Write everything ─────────────────────────────────────────────────────────
const drawio = `<mxfile host="app.diagrams.net" type="device">\n${ALL_PAGES.map(drawioPage).join('\n')}\n</mxfile>\n`;
fs.writeFileSync(path.join(OUT_DIR, 'learncode-architecture.drawio'), drawio);
console.log(`learncode-architecture.drawio   ${ALL_PAGES.length} pages, ${(drawio.match(/<mxCell /g) || []).length} cells`);

ALL_PAGES.forEach((p) => {
  const svg = svgPage(p);
  fs.writeFileSync(path.join(OUT_DIR, `${p.file}.svg`), svg + '\n');
  console.log(`${(p.file + '.svg').padEnd(32)}${p.w}x${p.h}, ${(svg.length / 1024).toFixed(0)}KB`);
});

// Self-check: the failure mode of a hand-edited layout is a swimlane whose
// height no longer matches its rows, which silently pushes the last field
// outside the box.
const bad = ALL_PAGES.flatMap((p) => (p.entities || []).filter((e) => h(e) !== HEADER + e.fields.length * ROW));
if (bad.length) {
  console.error('geometry mismatch:', bad.map((e) => e.id));
  process.exit(1);
}
console.log(`\n${DATA_PAGES.length} data-model pages, ${ALL_PAGES.length} pages total — geometry consistent.`);
