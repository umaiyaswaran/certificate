import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import { createRequire } from 'node:module';
import { MongoClient, ObjectId } from 'mongodb';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

let ZipArchive, sharp;
try { ZipArchive = require('archiver'); } catch { ZipArchive = null; }
try { sharp = require('sharp'); } catch { sharp = null; }

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const env = {
  uri: process.env.MONGODB_URI,
  database: process.env.MONGODB_DATABASE || 'certificate_generator',
  username: process.env.ADMIN_USERNAME || 'admin',
  hash: process.env.ADMIN_PASSWORD_HASH || '',
  secret: process.env.JWT_SECRET || 'local-development-secret',
  baseUrl: process.env.BASE_URL || ''
};

let client;
let db;
let collections;

async function connectDB() {
  if (db) return db;
  if (!env.uri) throw new Error('MONGODB_URI is required');
  client = new MongoClient(env.uri);
  await client.connect();
  db = client.db(env.database);

  collections = {
    admin: db.collection('admin'),
    settings: db.collection('settings'),
    events: db.collection('events'),
    participants: db.collection('participants'),
    signatories: db.collection('signatories'),
    certificates: db.collection('certificates')
  };

  for (const name of Object.keys(collections)) {
    try { await db.createCollection(name); } catch (e) { if (e.codeName !== 'NamespaceExists') throw e; }
  }

  await collections.certificates.createIndex({ certificate_id: 1 }, { unique: true });
  await collections.certificates.createIndex({ verification_token: 1 }, { unique: true });

  if (env.hash && env.hash.startsWith('$2')) {
    await collections.admin.updateOne(
      { username: env.username },
      { $setOnInsert: { username: env.username, password_hash: env.hash, created_at: new Date() } },
      { upsert: true }
    );
  }

  const defaultSettings = {
    college_name: 'Meenakshi Sundararajan Engineering College',
    department_name: 'Department of Artificial Intelligence and Data Science',
    club_name: 'Microsoft AI Club',
    college_logo: '',
    club_logo: '',
    watermark_logo: '',
    certificate_prefix: 'MICROAI',
    watermark_opacity: 0.07,
    watermark_size: 'large',
    watermark_position: 'center'
  };

  const existingSettings = await collections.settings.findOne({ key: 'organization' });
  if (!existingSettings) {
    await collections.settings.insertOne({ key: 'organization', ...defaultSettings });
  }

  return db;
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '5mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    cb(null, allowed.includes(file.mimetype));
  }
});

const auth = (req, res, next) => {
  if (req.originalUrl.startsWith('/api/assets/') || req.originalUrl.startsWith('/api/verify/') || req.originalUrl.startsWith('/api/templates/')) return next();
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'Authentication required' });
    jwt.verify(token, env.secret);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const safe = value => String(value || '').trim();
const toId = value => { try { return new ObjectId(value); } catch { return null; } };

// In-memory storage for logos/signatures on Vercel (no persistent FS)
const memStore = { logos: {}, signatures: {}, certificates: {} };

// ===== HEALTH =====
app.get('/api/health', async (_, res) => {
  try {
    await connectDB();
    await db.command({ ping: 1 });
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(i => i.name).filter(n => Object.hasOwn(collections, n));
    res.json({ status: 'ok', database: env.database, collections: names });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Database connection failed', error: error.message });
  }
});

// ===== AUTH =====
app.post('/api/auth/login', async (req, res) => {
  try {
    await connectDB();
    const admin = await collections.admin.findOne({ username: safe(req.body.username) });
    if (!admin || !await bcrypt.compare(req.body.password || '', admin.password_hash || '')) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    const token = jwt.sign({ sub: admin.username }, env.secret, { expiresIn: '8h' });
    res.json({ access_token: token, username: admin.username });
  } catch (error) {
    res.status(500).json({ message: 'Login failed' });
  }
});

app.post('/api/auth/logout', (_, res) => res.json({ ok: true }));

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ username: env.username });
});

// ===== SETTINGS =====
app.get('/api/settings', auth, async (_, res) => {
  try {
    await connectDB();
    const settings = await collections.settings.findOne({ key: 'organization' });
    res.json(settings || {});
  } catch (error) {
    res.status(500).json({ message: 'Failed to load settings' });
  }
});

app.put('/api/settings', auth, async (req, res) => {
  try {
    await connectDB();
    const updates = {};
    const allowed = ['college_name', 'department_name', 'club_name', 'certificate_prefix', 'watermark_opacity', 'watermark_size', 'watermark_position'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    await collections.settings.updateOne({ key: 'organization' }, { $set: updates }, { upsert: true });
    const settings = await collections.settings.findOne({ key: 'organization' });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update settings' });
  }
});

// ===== LOGOS =====
app.post('/api/assets/logo/:type', auth, upload.single('file'), async (req, res) => {
  if (!['college', 'club'].includes(req.params.type) || !req.file || !['image/png', 'image/jpeg'].includes(req.file.mimetype)) {
    return res.status(400).json({ message: 'Upload a PNG or JPG logo' });
  }
  try {
    await connectDB();
    const filename = `${req.params.type}_logo.png`;
    memStore.logos[req.params.type] = { buffer: req.file.buffer, filename };
    await collections.settings.updateOne(
      { key: 'organization' },
      { $set: { [`${req.params.type}_logo`]: `logos/${filename}` } },
      { upsert: true }
    );
    res.json({ url: `/api/assets/logo/${req.params.type}?v=${Date.now()}` });
  } catch (error) {
    res.status(500).json({ message: 'Logo upload failed' });
  }
});

app.get('/api/assets/logo/:type', async (req, res) => {
  if (!['college', 'club'].includes(req.params.type)) return res.sendStatus(404);
  try {
    const stored = memStore.logos[req.params.type];
    if (!stored) return res.sendStatus(404);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(stored.buffer);
  } catch {
    res.sendStatus(404);
  }
});

// ===== SIGNATORIES =====
app.get('/api/signatories', auth, async (_, res) => {
  try {
    await connectDB();
    const items = await collections.signatories.find().sort({ created_at: -1 }).toArray();
    res.json(items.map(item => ({ ...item, _id: item._id.toString() })));
  } catch (error) {
    res.status(500).json({ message: 'Failed to load signatories' });
  }
});

app.post('/api/signatories', auth, upload.single('signature'), async (req, res) => {
  const name = safe(req.body.name);
  const role = safe(req.body.role);
  if (!name || !role || !req.file || req.file.mimetype !== 'image/jpeg') {
    return res.status(400).json({ message: 'Name, role, and a JPG or JPEG signature are required' });
  }
  try {
    await connectDB();
    const filename = `${Date.now()}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.png`;
    let sigBuffer = req.file.buffer;
    if (sharp) {
      try {
        sigBuffer = await sharp(req.file.buffer).flatten({ background: '#ffffff' }).grayscale().png().toBuffer();
      } catch {}
    }
    const signatory = { name, role, signature_image: `signatures/${filename}`, created_at: new Date() };
    const result = await collections.signatories.insertOne(signatory);
    memStore.signatures[filename] = sigBuffer;
    res.json({ ...signatory, _id: result.insertedId.toString() });
  } catch (error) {
    res.status(500).json({ message: 'Failed to save signatory' });
  }
});

app.put('/api/signatories/:id', auth, upload.single('signature'), async (req, res) => {
  const signatoryId = toId(req.params.id);
  if (!signatoryId) return res.status(400).json({ message: 'Invalid signatory' });
  try {
    await connectDB();
    const updates = {};
    if (req.body.name) updates.name = safe(req.body.name);
    if (req.body.role) updates.role = safe(req.body.role);
    if (req.file && req.file.mimetype === 'image/jpeg') {
      const filename = `${Date.now()}_${(updates.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')}.png`;
      let sigBuffer = req.file.buffer;
      if (sharp) {
        try { sigBuffer = await sharp(req.file.buffer).flatten({ background: '#ffffff' }).grayscale().png().toBuffer(); } catch {}
      }
      updates.signature_image = `signatures/${filename}`;
      memStore.signatures[filename] = sigBuffer;
    }
    await collections.signatories.updateOne({ _id: signatoryId }, { $set: updates });
    const updated = await collections.signatories.findOne({ _id: signatoryId });
    res.json({ ...updated, _id: updated._id.toString() });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update signatory' });
  }
});

app.delete('/api/signatories/:id', auth, async (req, res) => {
  const signatoryId = toId(req.params.id);
  if (!signatoryId) return res.status(400).json({ message: 'Invalid signatory' });
  try {
    await connectDB();
    const signatory = await collections.signatories.findOne({ _id: signatoryId });
    if (signatory && signatory.signature_image) {
      const filename = path.basename(signatory.signature_image);
      delete memStore.signatures[filename];
    }
    await collections.signatories.deleteOne({ _id: signatoryId });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete signatory' });
  }
});

app.get('/api/assets/signature/:id', async (req, res) => {
  const signatoryId = toId(req.params.id);
  if (!signatoryId) return res.sendStatus(404);
  try {
    await connectDB();
    const signatory = await collections.signatories.findOne({ _id: signatoryId });
    if (!signatory || !signatory.signature_image) return res.sendStatus(404);
    const filename = path.basename(signatory.signature_image);
    const buffer = memStore.signatures[filename];
    if (!buffer) return res.sendStatus(404);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(buffer);
  } catch {
    res.sendStatus(404);
  }
});

// ===== TEMPLATES =====
app.get('/api/templates/:type', (req, res) => {
  const type = req.params.type;
  if (!['participation', 'winner'].includes(type)) return res.status(400).json({ message: 'Invalid certificate type' });
  const rows = type === 'winner'
    ? [['Student Name', 'Department', 'Year', 'Winning Place'], ['Arun Kumar', 'AI & DS', 'III', '1st Place'], ['Priya S', 'CSE', 'II', '2nd Place'], ['Rahul M', 'IT', 'III', '3rd Place']]
    : [['Student Name', 'Department', 'Year'], ['Arun Kumar', 'AI & DS', 'III'], ['Priya S', 'CSE', 'II'], ['Rahul M', 'IT', 'III']];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Participants');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  res.type('xlsx').attachment(`${type}_template.xlsx`).send(buffer);
});

// ===== EVENTS =====
app.post('/api/events', auth, async (req, res) => {
  try {
    await connectDB();
    const event = {
      event_name: safe(req.body.event_name),
      event_date: safe(req.body.event_date),
      certificate_type: req.body.certificate_type,
      created_at: new Date()
    };
    if (!event.event_name || !event.event_date || !['participation', 'winner'].includes(event.certificate_type)) {
      return res.status(400).json({ message: 'Event name, date, and type are required' });
    }
    const result = await collections.events.insertOne(event);
    res.json({ id: result.insertedId.toString(), ...event });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create event' });
  }
});

app.get('/api/events', auth, async (_, res) => {
  try {
    await connectDB();
    const events = await collections.events.find().sort({ created_at: -1 }).toArray();
    const result = [];
    for (const event of events) {
      const certCount = await collections.certificates.countDocuments({ event_id: event._id.toString() });
      result.push({ ...event, _id: event._id.toString(), certificate_count: certCount });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load events' });
  }
});

app.get('/api/events/:eventId', auth, async (req, res) => {
  const eventId = toId(req.params.eventId);
  if (!eventId) return res.status(400).json({ message: 'Invalid event' });
  try {
    await connectDB();
    const event = await collections.events.findOne({ _id: eventId });
    if (!event) return res.status(404).json({ message: 'Event not found' });
    const participants = await collections.participants.find({ event_id: eventId.toString() }).toArray();
    const certificates = await collections.certificates.find({ event_id: eventId.toString() }).toArray();
    res.json({
      ...event, _id: event._id.toString(),
      participants: participants.map(p => ({ ...p, _id: p._id.toString() })),
      certificates: certificates.map(c => ({ ...c, _id: c._id.toString() }))
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load event' });
  }
});

app.delete('/api/events/:eventId', auth, async (req, res) => {
  const eventId = toId(req.params.eventId);
  if (!eventId) return res.status(400).json({ message: 'Invalid event' });
  try {
    await connectDB();
    await collections.certificates.deleteMany({ event_id: eventId.toString() });
    await collections.participants.deleteMany({ event_id: eventId.toString() });
    await collections.events.deleteOne({ _id: eventId });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete event' });
  }
});

// ===== PARTICIPANTS =====
app.post('/api/events/:eventId/participants/upload', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Upload an Excel file' });
  const eventId = toId(req.params.eventId);
  if (!eventId) return res.status(400).json({ message: 'Invalid event' });

  let rows;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
  } catch {
    return res.status(400).json({ message: 'Invalid Excel file' });
  }

  const required = ['Student Name', 'Department', 'Year'];
  if (req.body.certificate_type === 'winner') required.push('Winning Place');

  const errors = [];
  const records = [];
  const seen = new Set();

  rows.forEach((row, index) => {
    const missing = required.filter(field => !safe(row[field]));
    const key = required.map(field => safe(row[field]).toLowerCase()).join('|');
    if (missing.length) {
      errors.push({ row: index + 2, message: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing` });
    } else if (seen.has(key)) {
      errors.push({ row: index + 2, message: 'Duplicate participant record' });
    } else {
      seen.add(key);
      records.push({
        event_id: eventId.toString(),
        student_name: safe(row['Student Name']),
        department: safe(row['Department']),
        year: safe(row['Year']),
        position: safe(row['Winning Place']) || safe(row['Position']) || null,
        created_at: new Date()
      });
    }
  });

  if (errors.length) return res.status(422).json({ errors, count: 0 });
  if (records.length) {
    await connectDB();
    await collections.participants.insertMany(records);
  }
  res.json({ count: records.length, participants: records });
});

app.get('/api/events/:eventId/participants', auth, async (req, res) => {
  const eventId = toId(req.params.eventId);
  if (!eventId) return res.status(400).json({ message: 'Invalid event' });
  try {
    await connectDB();
    const participants = await collections.participants.find({ event_id: eventId.toString() }).toArray();
    res.json(participants.map(p => ({ ...p, _id: p._id.toString() })));
  } catch (error) {
    res.status(500).json({ message: 'Failed to load participants' });
  }
});

// ===== PDF GENERATION =====
const fonts = {
  cinzel: path.join(__dirname, '..', 'backend', 'assets', 'fonts', 'Cinzel-SemiBold.ttf'),
  script: path.join(__dirname, '..', 'backend', 'assets', 'fonts', 'GreatVibes-Regular.ttf'),
  garamond: path.join(__dirname, '..', 'backend', 'assets', 'fonts', 'GARA.TTF'),
  garamondBold: path.join(__dirname, '..', 'backend', 'assets', 'fonts', 'GARABD.TTF'),
  georgia: path.join(__dirname, '..', 'backend', 'assets', 'fonts', 'georgia.ttf'),
  georgiaBold: path.join(__dirname, '..', 'backend', 'assets', 'fonts', 'georgiab.ttf'),
  segoe: path.join(__dirname, '..', 'backend', 'assets', 'fonts', 'segoeui.ttf'),
  segoeBold: path.join(__dirname, '..', 'backend', 'assets', 'fonts', 'segoeuib.ttf')
};

const pdfFont = (doc, file, fallback) => { try { doc.font(file); } catch { doc.font(fallback); } };
const fitPdfText = (doc, text, font, fallback, maxSize, minSize, maxWidth) => { for (let size = maxSize; size >= minSize; size -= 1) { pdfFont(doc, font, fallback); doc.fontSize(size); if (doc.widthOfString(text) <= maxWidth) return size; } return minSize; };
const pdfLines = (doc, text, font, size, width) => { doc.font(font).fontSize(size); return doc.heightOfString(text, { width, lineGap: 2 }); };

async function generatePDF(record, settings) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `${record.certificate_id} - ${record.student_name}`, Author: settings.club_name || 'Microsoft AI Club' } });
  const chunks = []; doc.on('data', chunk => chunks.push(chunk)); const complete = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const pageW = 841.89; const pageH = 595.28; const margin = 34; const inner = margin + 9;
  const navy = '#0B1F3A'; const gold = '#C9A227'; const lightGold = '#E8D28A'; const muted = '#667085'; const body = '#344054';

  doc.rect(0, 0, pageW, pageH).fill('#FFFDF8');
  const diagonal = (points, color) => { doc.fillColor(color).moveTo(points[0][0], points[0][1]); points.slice(1).forEach(([x, y]) => doc.lineTo(x, y)); doc.closePath().fill(); };
  diagonal([[0, 0], [0, 78], [92, 0]], navy); diagonal([[0, 0], [0, 33], [128, 0]], gold);
  diagonal([[pageW, pageH], [pageW, pageH - 35], [pageW - 125, pageH]], gold); diagonal([[pageW, pageH], [pageW, pageH - 82], [pageW - 88, pageH]], navy);
  diagonal([[0, pageH], [0, pageH - 82], [88, pageH]], navy); diagonal([[0, pageH], [0, pageH - 36], [127, pageH]], gold);
  diagonal([[pageW, 0], [pageW, 38], [pageW - 128, 0]], gold); diagonal([[pageW, 0], [pageW, 84], [pageW - 90, 0]], navy);
  doc.lineWidth(1.2).strokeColor(navy).rect(margin, margin, pageW - margin * 2, pageH - margin * 2).stroke();
  doc.lineWidth(0.8).strokeColor(gold).rect(inner, inner, pageW - inner * 2, pageH - inner * 2).stroke();

  const college = (settings.college_name || 'Meenakshi Sundararajan Engineering College').toUpperCase(); const parts = college.split(' ENGINEERING COLLEGE');
  pdfFont(doc, fonts.georgiaBold, 'Times-Bold'); doc.fillColor(navy).fontSize(18).text(parts[0] || college, 160, 48, { width: pageW - 320, align: 'center' });
  doc.fontSize(16).text(parts.length > 1 ? 'ENGINEERING COLLEGE' : '', 160, 70, { width: pageW - 320, align: 'center' });
  pdfFont(doc, fonts.georgia, 'Times-Roman'); doc.fillColor(muted).fontSize(7.3).text('(An Autonomous Institution) | Managed by IIEI Society', 160, 92, { width: pageW - 320, align: 'center' });
  doc.fontSize(7.2).text('Approved by AICTE, New Delhi | Affiliated to Anna University, Chennai', 160, 102, { width: pageW - 320, align: 'center' });
  doc.fontSize(7.2).text('A Recognized Research Center by Anna University', 160, 112, { width: pageW - 320, align: 'center' });
  pdfFont(doc, fonts.segoe, 'Helvetica'); doc.fontSize(8.5).text(settings.department_name || 'Department of Artificial Intelligence and Data Science', 160, 126, { width: pageW - 320, align: 'center' });

  const ribbon = (points, color) => { doc.fillColor(color).moveTo(points[0][0], points[0][1]); points.slice(1).forEach(point => doc.lineTo(point[0], point[1])); doc.closePath().fill(); };
  ribbon([[237, 129], [605, 129], [593, 161], [249, 161]], navy);
  ribbon([[237, 129], [249, 129], [256, 161], [249, 161]], gold); ribbon([[593, 161], [605, 129], [593, 129], [586, 161]], gold);
  doc.fillColor('#FFFDF8'); pdfFont(doc, fonts.segoeBold, 'Helvetica-Bold'); doc.fontSize(15).text((settings.club_name || 'Microsoft AI Club').toUpperCase(), 250, 138, { width: 342, align: 'center' });
  doc.fillColor(navy); pdfFont(doc, fonts.segoe, 'Helvetica'); doc.fontSize(7.5).text('INNOVATE  •  ANALYZE  •  CONNECT', 175, 169, { width: pageW - 350, align: 'center' });

  pdfFont(doc, fonts.cinzel, 'Times-Bold'); doc.fillColor(navy).fontSize(36).text('CERTIFICATE', 120, 193, { width: pageW - 240, align: 'center' });

  doc.lineWidth(0.8).strokeColor(gold);
  doc.moveTo(245, 238).lineTo(280, 238).stroke(); doc.moveTo(245, 242).lineTo(280, 242).stroke();
  doc.moveTo(562, 238).lineTo(597, 238).stroke(); doc.moveTo(562, 242).lineTo(597, 242).stroke();
  doc.lineWidth(1.2).strokeColor(gold).fillColor('#FFFDF8');
  doc.moveTo(295, 241).lineTo(285, 230).lineTo(557, 230).lineTo(547, 241).lineTo(557, 252).lineTo(285, 252).closePath().fillAndStroke();
  pdfFont(doc, fonts.segoeBold, 'Helvetica-Bold'); doc.fillColor(navy).fontSize(11).text(record.certificate_type === 'winner' ? 'OF ACHIEVEMENT' : 'OF PARTICIPATION', 285, 234, { width: 272, align: 'center' });

  doc.fillColor(muted).fontSize(8.5).text('P R O U D L Y   P R E S E N T E D   T O', 175, 266, { width: pageW - 350, align: 'center' });
  const nameSize = fitPdfText(doc, record.student_name || '', fonts.script, 'Times-Italic', 40, 22, 590); pdfFont(doc, fonts.script, 'Times-Italic'); doc.fillColor('#8C4B08').fontSize(nameSize).text(record.student_name || '', 110, 280, { width: pageW - 220, align: 'center', lineBreak: false });

  doc.strokeColor(gold).lineWidth(0.8);
  doc.moveTo(230, 334).lineTo(413, 334).stroke(); doc.moveTo(429, 334).lineTo(612, 334).stroke();
  doc.fillColor(gold); doc.moveTo(421, 330).lineTo(425, 334).lineTo(421, 338).lineTo(417, 334).closePath().fill();

  if (record.position) { doc.fillColor('#F5ECD7').roundedRect(360, 342, 122, 23, 11.5).fill(); doc.fillColor(gold); pdfFont(doc, fonts.segoeBold, 'Helvetica-Bold'); doc.fontSize(9.5).text(record.position.toUpperCase(), 360, 349, { width: 122, align: 'center' }); }

  const sentence = record.certificate_type === 'winner' && record.position
    ? `This certificate is proudly presented to ${record.student_name} from the Department of ${record.department}, Year ${record.year}, for securing ${record.position} in ${record.event_name}.`
    : `This certificate is proudly presented to ${record.student_name} from the Department of ${record.department}, Year ${record.year}, for successfully participating in ${record.event_name}.`;

  const bodyY = record.position ? 380 : 356; pdfFont(doc, fonts.georgia, 'Times-Roman'); const bodyHeight = pdfLines(doc, sentence, fonts.georgia, 11, 580); doc.fillColor(body).fontSize(11).text(sentence, 130, bodyY, { width: 580, align: 'center', lineGap: 3 });

  pdfFont(doc, fonts.segoe, 'Helvetica'); const date = record.event_date ? new Date(`${record.event_date}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : ''; doc.fillColor(muted).fontSize(9.5).text(`Event held on ${date}.`, 130, bodyY + bodyHeight + 12, { width: 580, align: 'center' });

  const signatures = (record.signatures || []).slice(0, 4); const sigW = 130; const sigH = 52;
  const signatureSlots = signatures.length === 1
    ? [{ x: pageW / 2 - sigW / 2, y: 475 }]
    : signatures.length === 2
      ? [{ x: 168, y: 475 }, { x: 537, y: 475 }]
      : signatures.length === 3
        ? [{ x: 105, y: 475 }, { x: 352, y: 475 }, { x: 599, y: 475 }]
        : [{ x: 132, y: 455 }, { x: 515, y: 455 }, { x: 132, y: 530 }, { x: 515, y: 530 }];

  for (const [index, sig] of signatures.entries()) {
    const slot = signatureSlots[index];
    const sigBuffer = memStore.signatures[path.basename(sig.signature_image || '')];
    if (sigBuffer) {
      try { doc.image(sigBuffer, slot.x + 12, slot.y - 34, { fit: [sigW - 24, sigH], align: 'center', valign: 'center' }); } catch {}
    }
    doc.strokeColor('#4b5563').lineWidth(0.6).moveTo(slot.x + 10, slot.y + 1).lineTo(slot.x + sigW - 10, slot.y + 1).stroke();
    pdfFont(doc, fonts.segoeBold, 'Helvetica-Bold'); doc.fillColor('#111827').fontSize(7.8).text(sig.name || '', slot.x - 8, slot.y + 8, { width: sigW + 16, align: 'center' });
    pdfFont(doc, fonts.segoeBold, 'Helvetica-Bold'); doc.fillColor('#475569').fontSize(6.4).text(sig.role || '', slot.x - 12, slot.y + 20, { width: sigW + 24, align: 'center' });
  }

  const certificateIdY = signatures.length === 4 ? 568 : 541;
  pdfFont(doc, fonts.segoe, 'Helvetica'); doc.fillColor(muted).fontSize(8.5).text(`Certificate ID: ${record.certificate_id}`, 175, certificateIdY, { width: pageW - 350, align: 'center' });

  doc.fillColor(gold); doc.circle(195, 567, 3.5).fill(); doc.circle(pageW - 195, 567, 3.5).fill();
  pdfFont(doc, fonts.segoeBold, 'Helvetica-Bold'); doc.fillColor(navy).fontSize(8.5).text((settings.club_name || 'Microsoft AI Club').toUpperCase(), 210, 562, { width: pageW - 420, align: 'center' });
  pdfFont(doc, fonts.segoe, 'Helvetica'); doc.fillColor(muted).fontSize(7.2).text('INNOVATE  •  ANALYZE  •  CONNECT', 210, 573, { width: pageW - 420, align: 'center' });

  doc.end(); return complete;
}

// ===== CERTIFICATES =====
app.post('/api/events/:eventId/certificates/generate', auth, async (req, res) => {
  try {
    await connectDB();
    const eventId = toId(req.params.eventId);
    const event = eventId && await collections.events.findOne({ _id: eventId });
    if (!event) return res.status(404).json({ message: 'Event not found' });

    const participantIds = (req.body.participant_ids || []).map(toId).filter(Boolean);
    if (!participantIds.length) return res.status(400).json({ message: 'Select at least one participant' });

    const participants = await collections.participants.find({ _id: { $in: participantIds } }).toArray();
    const settings = await collections.settings.findOne({ key: 'organization' }) || {};
    const signatoryIds = (req.body.signatory_ids || []).map(toId).filter(Boolean);
    const selectedSignatories = signatoryIds.length
      ? await collections.signatories.find({ _id: { $in: signatoryIds } }).toArray()
      : [];

    const prefix = settings.certificate_prefix || 'MICROAI';
    const year = event.event_date.slice(0, 4);
    const output = [];

    for (const participant of participants) {
      const count = await collections.certificates.countDocuments({});
      const certificate_id = `${prefix}-${year}-${String(count + 1).padStart(4, '0')}`;
      const record = {
        certificate_id, event_id: eventId.toString(), participant_id: participant._id.toString(),
        student_name: participant.student_name, department: participant.department, year: participant.year,
        position: participant.position, certificate_type: event.certificate_type, event_name: event.event_name,
        event_date: event.event_date, signatures: selectedSignatories.map(s => ({ name: s.name, role: s.role, signature_image: s.signature_image })),
        verification_token: `${certificate_id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        status: 'valid', created_at: new Date()
      };

      try {
        const pdf = await generatePDF(record, settings);
        output.push({ certificate_id, filename: null, student_name: participant.student_name, pdf });
        await collections.certificates.insertOne({ ...record, pdf_path: null });
      } catch (error) {
        console.error(`Failed to generate certificate for ${participant.student_name}:`, error);
      }
    }

    res.json({ count: output.length, certificates: output.map(c => ({ certificate_id: c.certificate_id, student_name: c.student_name })) });
  } catch (error) {
    res.status(500).json({ message: 'Certificate generation failed' });
  }
});

app.get('/api/certificates/:certificateId', auth, async (req, res) => {
  await connectDB();
  const record = await collections.certificates.findOne({ certificate_id: safe(req.params.certificateId) });
  if (!record) return res.status(404).json({ message: 'Certificate not found' });
  const { _id, verification_token, ...publicData } = record;
  res.json(publicData);
});

app.get('/api/certificates/:certificateId/download', async (req, res) => {
  await connectDB();
  const record = await collections.certificates.findOne({ certificate_id: safe(req.params.certificateId) });
  if (!record) return res.status(404).json({ message: 'Certificate not found' });
  res.status(404).json({ message: 'PDF download not available on serverless. Use API to generate.' });
});

app.get('/api/events/:eventId/certificates/zip', auth, async (req, res) => {
  await connectDB();
  const records = await collections.certificates.find({ event_id: req.params.eventId }).toArray();
  if (!records.length) return res.status(404).json({ message: 'No certificates found' });
  res.status(404).json({ message: 'ZIP download not available on serverless deployment' });
});

app.post('/api/certificates/:certificateId/revoke', auth, async (req, res) => {
  await connectDB();
  const record = await collections.certificates.findOne({ certificate_id: safe(req.params.certificateId) });
  if (!record) return res.status(404).json({ message: 'Certificate not found' });
  await collections.certificates.updateOne({ certificate_id: record.certificate_id }, { $set: { status: 'revoked' } });
  res.json({ ok: true });
});

// ===== VERIFICATION =====
app.get('/api/verify/:certificateId', async (req, res) => {
  await connectDB();
  const record = await collections.certificates.findOne({ certificate_id: safe(req.params.certificateId) });
  if (!record) return res.status(404).json({ message: 'Certificate not found' });
  res.json({
    certificate_id: record.certificate_id, student_name: record.student_name, event_name: record.event_name,
    event_date: record.event_date, certificate_type: record.certificate_type, department: record.department,
    year: record.year, position: record.position, status: record.status,
    issued_by: 'Microsoft AI Club', institution: 'Meenakshi Sundararajan Engineering College'
  });
});

// ===== DASHBOARD STATS =====
app.get('/api/dashboard/stats', auth, async (_, res) => {
  try {
    await connectDB();
    const totalEvents = await collections.events.countDocuments({});
    const totalCertificates = await collections.certificates.countDocuments({});
    const participationCount = await collections.certificates.countDocuments({ certificate_type: 'participation' });
    const winnerCount = await collections.certificates.countDocuments({ certificate_type: 'winner' });
    res.json({ totalEvents, totalCertificates, participationCount, winnerCount });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load stats' });
  }
});

// Vercel serverless export
export default app;
