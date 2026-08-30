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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const isVercel = process.env.VERCEL === '1';
const fontRoot = isVercel
  ? path.join(__dirname, 'backend', 'assets', 'fonts')
  : path.join(__dirname, '..', 'backend', 'assets', 'fonts');

const fonts = {
  cinzel: path.join(fontRoot, 'Cinzel-SemiBold.ttf'),
  script: path.join(fontRoot, 'GreatVibes-Regular.ttf'),
  garamond: path.join(fontRoot, 'GARA.TTF'),
  garamondBold: path.join(fontRoot, 'GARABD.TTF'),
  georgia: path.join(fontRoot, 'georgia.ttf'),
  georgiaBold: path.join(fontRoot, 'georgiab.ttf'),
  segoe: path.join(fontRoot, 'segoeui.ttf'),
  segoeBold: path.join(fontRoot, 'segoeuib.ttf')
};

let ZipArchive;
let sharp;
try { const r = createRequire(import.meta.url); ({ ZipArchive } = r('archiver')); } catch {}
try { const r = createRequire(import.meta.url); sharp = r('sharp'); } catch {}

const env = {
  uri: process.env.MONGODB_URI,
  database: process.env.MONGODB_DATABASE || 'certificate_generator',
  username: process.env.ADMIN_USERNAME || 'admin',
  hash: process.env.ADMIN_PASSWORD_HASH || '',
  secret: process.env.JWT_SECRET || 'local-development-secret',
};

let client, db, collections;

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
  const existing = await collections.settings.findOne({ key: 'organization' });
  if (!existing) {
    await collections.settings.insertOne({
      key: 'organization',
      college_name: 'Meenakshi Sundararajan Engineering College',
      department_name: 'Department of Artificial Intelligence and Data Science',
      club_name: 'Microsoft AI Club',
      college_logo: '', club_logo: '',
      certificate_prefix: 'MICROAI',
      watermark_opacity: 0.07, watermark_size: 'large', watermark_position: 'center'
    });
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
    cb(null, ['image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'].includes(file.mimetype));
  }
});

const auth = (req, res, next) => {
  if (req.originalUrl.startsWith('/api/assets/') || req.originalUrl.startsWith('/api/verify/') || req.originalUrl.startsWith('/api/templates/')) return next();
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'Authentication required' });
    jwt.verify(token, env.secret);
    next();
  } catch { res.status(401).json({ message: 'Invalid or expired token' }); }
};

const safe = v => String(v || '').trim();
const toId = v => { try { return new ObjectId(v); } catch { return null; } };

// ===== HEALTH =====
app.get('/api/health', async (_, res) => {
  try { await connectDB(); await db.command({ ping: 1 }); res.json({ status: 'ok', database: env.database }); }
  catch (e) { res.status(500).json({ status: 'error', message: e.message }); }
});

// ===== AUTH =====
app.post('/api/auth/login', async (req, res) => {
  try {
    await connectDB();
    const admin = await collections.admin.findOne({ username: safe(req.body.username) });
    if (!admin || !await bcrypt.compare(req.body.password || '', admin.password_hash || ''))
      return res.status(401).json({ message: 'Invalid username or password' });
    const token = jwt.sign({ sub: admin.username }, env.secret, { expiresIn: '8h' });
    res.json({ access_token: token, username: admin.username });
  } catch { res.status(500).json({ message: 'Login failed' }); }
});
app.post('/api/auth/logout', (_, res) => res.json({ ok: true }));
app.get('/api/auth/me', auth, (_, res) => res.json({ username: env.username }));

// ===== SETTINGS =====
app.get('/api/settings', auth, async (_, res) => {
  try { await connectDB(); res.json(await collections.settings.findOne({ key: 'organization' }) || {}); }
  catch { res.status(500).json({ message: 'Failed to load settings' }); }
});
app.put('/api/settings', auth, async (req, res) => {
  try {
    await connectDB();
    const updates = {};
    for (const key of ['college_name', 'department_name', 'club_name', 'certificate_prefix', 'watermark_opacity', 'watermark_size', 'watermark_position'])
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    await collections.settings.updateOne({ key: 'organization' }, { $set: updates }, { upsert: true });
    res.json(await collections.settings.findOne({ key: 'organization' }));
  } catch { res.status(500).json({ message: 'Failed to update settings' }); }
});

// ===== LOGOS (base64 in MongoDB) =====
app.post('/api/assets/logo/:type', auth, upload.single('file'), async (req, res) => {
  if (!['college', 'club'].includes(req.params.type) || !req.file || !['image/png', 'image/jpeg'].includes(req.file.mimetype))
    return res.status(400).json({ message: 'Upload a PNG or JPG logo' });
  try {
    await connectDB();
    let buffer = req.file.buffer;
    if (sharp) try { buffer = await sharp(buffer).png().toBuffer(); } catch {}
    const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
    await collections.settings.updateOne({ key: 'organization' }, { $set: { [`${req.params.type}_logo`]: base64 } }, { upsert: true });
    res.json({ url: `/api/assets/logo/${req.params.type}?v=${Date.now()}` });
  } catch { res.status(500).json({ message: 'Logo upload failed' }); }
});
app.get('/api/assets/logo/:type', async (req, res) => {
  if (!['college', 'club'].includes(req.params.type)) return res.sendStatus(404);
  try {
    await connectDB();
    const settings = await collections.settings.findOne({ key: 'organization' });
    const b64 = settings?.[`${req.params.type}_logo`];
    if (!b64) return res.sendStatus(404);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(b64.split(',')[1] || '', 'base64'));
  } catch { res.sendStatus(404); }
});

// ===== SIGNATORIES (base64 in MongoDB) =====
app.get('/api/signatories', auth, async (_, res) => {
  try { await connectDB(); res.json((await collections.signatories.find().sort({ created_at: -1 }).toArray()).map(i => ({ ...i, _id: i._id.toString() }))); }
  catch { res.status(500).json({ message: 'Failed to load signatories' }); }
});
app.post('/api/signatories', auth, upload.single('signature'), async (req, res) => {
  const name = safe(req.body.name), role = safe(req.body.role);
  if (!name || !role || !req.file || req.file.mimetype !== 'image/jpeg')
    return res.status(400).json({ message: 'Name, role, and a JPG or JPEG signature are required' });
  try {
    await connectDB();
    let buffer = req.file.buffer;
    if (sharp) try {
      const { data, info } = await sharp(buffer).grayscale().normalize().threshold(160).negate().raw().toBuffer({ resolveWithObject: true });
      const rgba = Buffer.alloc(info.width * info.height * 4);
      for (let i = 0; i < data.length; i++) { const lum = data[i]; const o = i * 4; rgba[o] = 0; rgba[o+1] = 0; rgba[o+2] = 0; rgba[o+3] = lum > 128 ? 255 : 0; }
      buffer = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    } catch {}
    const signatory = { name, role, signature_image: `data:image/png;base64,${buffer.toString('base64')}`, created_at: new Date() };
    const result = await collections.signatories.insertOne(signatory);
    res.json({ ...signatory, _id: result.insertedId.toString() });
  } catch { res.status(500).json({ message: 'Failed to save signatory' }); }
});
app.put('/api/signatories/:id', auth, upload.single('signature'), async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid signatory' });
  try {
    await connectDB();
    const updates = {};
    if (req.body.name) updates.name = safe(req.body.name);
    if (req.body.role) updates.role = safe(req.body.role);
    if (req.file && req.file.mimetype === 'image/jpeg') {
      let buffer = req.file.buffer;
      if (sharp) try {
        const { data, info } = await sharp(buffer).grayscale().normalize().threshold(160).negate().raw().toBuffer({ resolveWithObject: true });
        const rgba = Buffer.alloc(info.width * info.height * 4);
        for (let i = 0; i < data.length; i++) { const lum = data[i]; const o = i * 4; rgba[o] = 0; rgba[o+1] = 0; rgba[o+2] = 0; rgba[o+3] = lum > 128 ? 255 : 0; }
        buffer = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
      } catch {}
      updates.signature_image = `data:image/png;base64,${buffer.toString('base64')}`;
    }
    await collections.signatories.updateOne({ _id: id }, { $set: updates });
    const updated = await collections.signatories.findOne({ _id: id });
    res.json({ ...updated, _id: updated._id.toString() });
  } catch { res.status(500).json({ message: 'Failed to update signatory' }); }
});
app.delete('/api/signatories/:id', auth, async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ message: 'Invalid signatory' });
  try { await connectDB(); await collections.signatories.deleteOne({ _id: id }); res.json({ ok: true }); }
  catch { res.status(500).json({ message: 'Failed to delete signatory' }); }
});
app.get('/api/assets/signature/:id', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.sendStatus(404);
  try {
    await connectDB();
    const sig = await collections.signatories.findOne({ _id: id });
    if (!sig?.signature_image) return res.sendStatus(404);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(sig.signature_image.split(',')[1] || '', 'base64'));
  } catch { res.sendStatus(404); }
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
  res.type('xlsx').attachment(`${type}_template.xlsx`).send(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
});

// ===== EVENTS =====
app.post('/api/events', auth, async (req, res) => {
  try {
    await connectDB();
    const event = { event_name: safe(req.body.event_name), event_date: safe(req.body.event_date), certificate_type: req.body.certificate_type, created_at: new Date() };
    if (!event.event_name || !event.event_date || !['participation', 'winner'].includes(event.certificate_type))
      return res.status(400).json({ message: 'Event name, date, and type are required' });
    const result = await collections.events.insertOne(event);
    res.json({ id: result.insertedId.toString(), ...event });
  } catch { res.status(500).json({ message: 'Failed to create event' }); }
});
app.get('/api/events', auth, async (_, res) => {
  try {
    await connectDB();
    const events = await collections.events.find().sort({ created_at: -1 }).toArray();
    res.json(await Promise.all(events.map(async e => ({
      ...e, _id: e._id.toString(), certificate_count: await collections.certificates.countDocuments({ event_id: e._id.toString() })
    }))));
  } catch { res.status(500).json({ message: 'Failed to load events' }); }
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
    res.json({ ...event, _id: event._id.toString(), participants: participants.map(p => ({ ...p, _id: p._id.toString() })), certificates: certificates.map(c => ({ ...c, _id: c._id.toString() })) });
  } catch { res.status(500).json({ message: 'Failed to load event' }); }
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
  } catch { res.status(500).json({ message: 'Failed to delete event' }); }
});

// ===== PARTICIPANTS =====
app.post('/api/events/:eventId/participants/upload', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Upload an Excel file' });
  const eventId = toId(req.params.eventId);
  if (!eventId) return res.status(400).json({ message: 'Invalid event' });
  let rows;
  try { const wb = XLSX.read(req.file.buffer, { type: 'buffer' }); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }); }
  catch { return res.status(400).json({ message: 'Invalid Excel file' }); }
  const required = ['Student Name', 'Department', 'Year'];
  if (req.body.certificate_type === 'winner') required.push('Winning Place');
  const errors = [], records = [], seen = new Set();
  rows.forEach((row, i) => {
    const missing = required.filter(f => !safe(row[f]));
    const key = required.map(f => safe(row[f]).toLowerCase()).join('|');
    if (missing.length) errors.push({ row: i + 2, message: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing` });
    else if (seen.has(key)) errors.push({ row: i + 2, message: 'Duplicate participant record' });
    else { seen.add(key); records.push({ event_id: eventId.toString(), student_name: safe(row['Student Name']), department: safe(row['Department']), year: safe(row['Year']), position: safe(row['Winning Place']) || safe(row['Position']) || null, created_at: new Date() }); }
  });
  if (errors.length) return res.status(422).json({ errors, count: 0 });
  if (records.length) { await connectDB(); await collections.participants.insertMany(records); }
  res.json({ count: records.length, participants: records });
});
app.get('/api/events/:eventId/participants', auth, async (req, res) => {
  const eventId = toId(req.params.eventId);
  if (!eventId) return res.status(400).json({ message: 'Invalid event' });
  try { await connectDB(); res.json((await collections.participants.find({ event_id: eventId.toString() }).toArray()).map(p => ({ ...p, _id: p._id.toString() }))); }
  catch { res.status(500).json({ message: 'Failed to load participants' }); }
});

// ===== PDF GENERATION =====
const pdfFont = (doc, file, fb) => { try { doc.font(file); } catch { doc.font(fb); } };
const fitPdfText = (doc, text, font, fb, max, min, w) => { for (let s = max; s >= min; s--) { pdfFont(doc, font, fb); doc.fontSize(s); if (doc.widthOfString(text) <= w) return s; } return min; };
const pdfLines = (doc, text, font, size, w) => { doc.font(font).fontSize(size); return doc.heightOfString(text, { width: w, lineGap: 2 }); };

async function generatePDF(record, settings) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `${record.certificate_id} - ${record.student_name}`, Author: settings.club_name || 'Microsoft AI Club' } });
  const chunks = []; doc.on('data', c => chunks.push(c));
  const complete = new Promise(r => doc.on('end', () => r(Buffer.concat(chunks))));
  const W = 841.89, H = 595.28, m = 34, inner = m + 9;
  const navy = '#0B1F3A', gold = '#C9A227', muted = '#667085', body = '#344054';
  const diag = (pts, c) => { doc.fillColor(c).moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(([x, y]) => doc.lineTo(x, y)); doc.closePath().fill(); };

  doc.rect(0, 0, W, H).fill('#FFFDF8');
  diag([[0,0],[0,78],[92,0]],navy); diag([[0,0],[0,33],[128,0]],gold);
  diag([[W,H],[W,H-35],[W-125,H]],gold); diag([[W,H],[W,H-82],[W-88,H]],navy);
  diag([[0,H],[0,H-82],[88,H]],navy); diag([[0,H],[0,H-36],[127,H]],gold);
  diag([[W,0],[W,38],[W-128,0]],gold); diag([[W,0],[W,84],[W-90,0]],navy);
  doc.lineWidth(1.2).strokeColor(navy).rect(m, m, W-m*2, H-m*2).stroke();
  doc.lineWidth(0.8).strokeColor(gold).rect(inner, inner, W-inner*2, H-inner*2).stroke();

  // Circuit traces
  doc.strokeColor('#C9A22740').fillColor('#C9A22740').lineWidth(0.6);
  doc.moveTo(34,180).lineTo(70,216).lineTo(70,360).lineTo(45,385).stroke().circle(45,385,2.5).fill();
  doc.moveTo(34,250).lineTo(55,271).lineTo(55,320).stroke().circle(55,320,2.5).fill();
  doc.moveTo(34,430).lineTo(85,379).lineTo(85,280).stroke().circle(85,280,2.5).fill();
  doc.moveTo(W-34,180).lineTo(W-70,216).lineTo(W-70,360).lineTo(W-45,385).stroke().circle(W-45,385,2.5).fill();
  doc.moveTo(W-34,250).lineTo(W-55,271).lineTo(W-55,320).stroke().circle(W-55,320,2.5).fill();
  doc.moveTo(W-34,430).lineTo(W-85,379).lineTo(W-85,280).stroke().circle(W-85,280,2.5).fill();

  // Logos from base64
  const drawB64 = (b64, x, y, opts) => { if (!b64) return; try { doc.image(Buffer.from(b64.split(',')[1], 'base64'), x, y, opts); } catch {} };
  drawB64(settings.college_logo, 48, 35, { fit: [105, 105] });
  drawB64(settings.club_logo, W-153, 35, { fit: [100, 100] });
  drawB64(settings.club_logo, W/2-100, H/2-100, { fit: [200, 200], opacity: 0.065 });

  // Header
  const college = (settings.college_name || 'Meenakshi Sundararajan Engineering College').toUpperCase();
  const parts = college.split(' ENGINEERING COLLEGE');
  pdfFont(doc, fonts.georgiaBold, 'Times-Bold'); doc.fillColor(navy).fontSize(18).text(parts[0] || college, 160, 48, { width: W-320, align: 'center' });
  doc.fontSize(16).text(parts.length > 1 ? 'ENGINEERING COLLEGE' : '', 160, 70, { width: W-320, align: 'center' });
  pdfFont(doc, fonts.georgia, 'Times-Roman'); doc.fillColor(muted).fontSize(7.3).text('(An Autonomous Institution) | Managed by IIEI Society', 160, 92, { width: W-320, align: 'center' });
  doc.fontSize(7.2).text('Approved by AICTE, New Delhi | Affiliated to Anna University, Chennai', 160, 102, { width: W-320, align: 'center' });
  doc.fontSize(7.2).text('A Recognized Research Center by Anna University', 160, 112, { width: W-320, align: 'center' });
  pdfFont(doc, fonts.segoe, 'Helvetica'); doc.fontSize(8.5).text(settings.department_name || 'Department of Artificial Intelligence and Data Science', 160, 126, { width: W-320, align: 'center' });

  // Club banner
  const ribbon = (pts, c) => { doc.fillColor(c).moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => doc.lineTo(p[0], p[1])); doc.closePath().fill(); };
  ribbon([[237,129],[605,129],[593,161],[249,161]], navy);
  ribbon([[237,129],[249,129],[256,161],[249,161]], gold);
  ribbon([[593,161],[605,129],[593,129],[586,161]], gold);
  doc.fillColor('#FFFDF8'); pdfFont(doc, fonts.segoeBold, 'Helvetica-Bold'); doc.fontSize(15).text((settings.club_name || 'Microsoft AI Club').toUpperCase(), 250, 138, { width: 342, align: 'center' });
  doc.fillColor(navy); pdfFont(doc, fonts.segoe, 'Helvetica'); doc.fontSize(7.5).text('INNOVATE  •  ANALYZE  •  CONNECT', 175, 169, { width: W-350, align: 'center' });

  // Title
  pdfFont(doc, fonts.cinzel, 'Times-Bold'); doc.fillColor(navy).fontSize(36).text('CERTIFICATE', 120, 193, { width: W-240, align: 'center' });

  // Subtitle
  doc.lineWidth(0.8).strokeColor(gold);
  doc.moveTo(245,238).lineTo(280,238).stroke(); doc.moveTo(245,242).lineTo(280,242).stroke();
  doc.moveTo(562,238).lineTo(597,238).stroke(); doc.moveTo(562,242).lineTo(597,242).stroke();
  doc.lineWidth(1.2).strokeColor(gold).fillColor('#FFFDF8');
  doc.moveTo(295,241).lineTo(285,230).lineTo(557,230).lineTo(547,241).lineTo(557,252).lineTo(285,252).closePath().fillAndStroke();
  pdfFont(doc, fonts.segoeBold, 'Helvetica-Bold'); doc.fillColor(navy).fontSize(11).text(record.certificate_type === 'winner' ? 'OF ACHIEVEMENT' : 'OF PARTICIPATION', 285, 234, { width: 272, align: 'center' });

  // Recipient
  doc.fillColor(muted).fontSize(8.5).text('P R O U D L Y   P R E S E N T E D   T O', 175, 266, { width: W-350, align: 'center' });
  const ns = fitPdfText(doc, record.student_name || '', fonts.script, 'Times-Italic', 40, 22, 590);
  pdfFont(doc, fonts.script, 'Times-Italic'); doc.fillColor('#8C4B08').fontSize(ns).text(record.student_name || '', 110, 280, { width: W-220, align: 'center', lineBreak: false });

  // Name underline
  doc.strokeColor(gold).lineWidth(0.8);
  doc.moveTo(230,334).lineTo(413,334).stroke(); doc.moveTo(429,334).lineTo(612,334).stroke();
  doc.fillColor(gold); doc.moveTo(421,330).lineTo(425,334).lineTo(421,338).lineTo(417,334).closePath().fill();

  if (record.position) { doc.fillColor('#F5ECD7').roundedRect(360,342,122,23,11.5).fill(); doc.fillColor(gold); pdfFont(doc, fonts.segoeBold, 'Helvetica-Bold'); doc.fontSize(9.5).text(record.position.toUpperCase(), 360, 349, { width: 122, align: 'center' }); }

  // Body
  const sentence = record.certificate_type === 'winner' && record.position
    ? `This certificate is proudly presented to ${record.student_name} from the Department of ${record.department}, Year ${record.year}, for securing ${record.position} in ${record.event_name}.`
    : `This certificate is proudly presented to ${record.student_name} from the Department of ${record.department}, Year ${record.year}, for successfully participating in ${record.event_name}.`;
  const bY = record.position ? 380 : 356;
  pdfFont(doc, fonts.georgia, 'Times-Roman'); const bH = pdfLines(doc, sentence, fonts.georgia, 11, 580);
  doc.fillColor(body).fontSize(11).text(sentence, 130, bY, { width: 580, align: 'center', lineGap: 3 });
  pdfFont(doc, fonts.segoe, 'Helvetica');
  const date = record.event_date ? new Date(`${record.event_date}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '';
  doc.fillColor(muted).fontSize(9.5).text(`Event held on ${date}.`, 130, bY + bH + 12, { width: 580, align: 'center' });

  // Signatures
  const sigs = (record.signatures || []).slice(0, 4), sW = 130, sH = 52;
  const slots = sigs.length === 1 ? [{ x: W/2-sW/2, y: 475 }] : sigs.length === 2 ? [{ x: 168, y: 475 }, { x: 537, y: 475 }] : sigs.length === 3 ? [{ x: 105, y: 475 }, { x: 352, y: 475 }, { x: 599, y: 475 }] : [{ x: 132, y: 455 }, { x: 515, y: 455 }, { x: 132, y: 530 }, { x: 515, y: 530 }];
  for (const [i, sig] of sigs.entries()) {
    const sl = slots[i];
    if (sig.signature_image?.startsWith('data:')) {
      try { doc.image(Buffer.from(sig.signature_image.split(',')[1], 'base64'), sl.x+12, sl.y-34, { fit: [sW-24, sH], align: 'center', valign: 'center' }); } catch {}
    }
    doc.strokeColor('#4b5563').lineWidth(0.6).moveTo(sl.x+10, sl.y+1).lineTo(sl.x+sW-10, sl.y+1).stroke();
    pdfFont(doc, fonts.segoeBold, 'Helvetica-Bold'); doc.fillColor('#111827').fontSize(7.8).text(sig.name || '', sl.x-8, sl.y+8, { width: sW+16, align: 'center' });
    doc.fillColor('#475569').fontSize(6.4).text(sig.role || '', sl.x-12, sl.y+20, { width: sW+24, align: 'center' });
  }

  // Footer
  const cIdY = sigs.length === 4 ? 568 : 541;
  pdfFont(doc, fonts.segoe, 'Helvetica'); doc.fillColor(muted).fontSize(8.5).text(`Certificate ID: ${record.certificate_id}`, 175, cIdY, { width: W-350, align: 'center' });
  doc.fillColor(gold); doc.circle(195,567,3.5).fill(); doc.circle(W-195,567,3.5).fill();
  pdfFont(doc, fonts.segoeBold, 'Helvetica-Bold'); doc.fillColor(navy).fontSize(8.5).text((settings.club_name || 'Microsoft AI Club').toUpperCase(), 210, 562, { width: W-420, align: 'center' });
  pdfFont(doc, fonts.segoe, 'Helvetica'); doc.fillColor(muted).fontSize(7.2).text('INNOVATE  •  ANALYZE  •  CONNECT', 210, 573, { width: W-420, align: 'center' });
  doc.end(); return complete;
}

// ===== CERTIFICATES =====
app.post('/api/events/:eventId/certificates/generate', auth, async (req, res) => {
  try {
    await connectDB();
    const eventId = toId(req.params.eventId);
    const event = eventId && await collections.events.findOne({ _id: eventId });
    if (!event) return res.status(404).json({ message: 'Event not found' });
    const pIds = (req.body.participant_ids || []).map(toId).filter(Boolean);
    if (!pIds.length) return res.status(400).json({ message: 'Select at least one participant' });
    const participants = await collections.participants.find({ _id: { $in: pIds } }).toArray();
    const settings = await collections.settings.findOne({ key: 'organization' }) || {};
    const sIds = (req.body.signatory_ids || []).map(toId).filter(Boolean);
    const sigs = sIds.length ? await collections.signatories.find({ _id: { $in: sIds } }).toArray() : [];
    const prefix = settings.certificate_prefix || 'MICROAI', year = event.event_date.slice(0, 4);
    const output = [];
    for (const p of participants) {
      const count = await collections.certificates.countDocuments({});
      const cid = `${prefix}-${year}-${String(count+1).padStart(4,'0')}`;
      const record = { certificate_id: cid, event_id: eventId.toString(), participant_id: p._id.toString(), student_name: p.student_name, department: p.department, year: p.year, position: p.position, certificate_type: event.certificate_type, event_name: event.event_name, event_date: event.event_date, signatures: sigs.map(s => ({ name: s.name, role: s.role, signature_image: s.signature_image })), verification_token: `${cid}-${Date.now()}-${Math.random().toString(36).slice(2)}`, status: 'valid', created_at: new Date() };
      try { await collections.certificates.insertOne({ ...record }); output.push({ certificate_id: cid, student_name: p.student_name }); } catch (e) { console.error(`Cert fail ${p.student_name}:`, e); }
    }
    res.json({ count: output.length, certificates: output });
  } catch { res.status(500).json({ message: 'Certificate generation failed' }); }
});

app.get('/api/certificates/:certificateId', auth, async (req, res) => {
  await connectDB();
  const rec = await collections.certificates.findOne({ certificate_id: safe(req.params.certificateId) });
  if (!rec) return res.status(404).json({ message: 'Certificate not found' });
  const { _id, verification_token, ...pub } = rec; res.json(pub);
});

app.get('/api/certificates/:certificateId/download', async (req, res) => {
  await connectDB();
  const rec = await collections.certificates.findOne({ certificate_id: safe(req.params.certificateId) });
  if (!rec) return res.status(404).json({ message: 'Certificate not found' });
  const settings = await collections.settings.findOne({ key: 'organization' }) || {};
  try {
    const pdf = await generatePDF(rec, settings);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${rec.student_name.replace(/[^a-zA-Z0-9]/g,'_')}_${rec.certificate_id}.pdf"`);
    res.send(pdf);
  } catch { res.status(500).json({ message: 'PDF generation failed' }); }
});

app.get('/api/events/:eventId/certificates/zip', auth, async (req, res) => {
  if (!ZipArchive) return res.status(501).json({ message: 'ZIP download not available' });
  await connectDB();
  const records = await collections.certificates.find({ event_id: req.params.eventId }).toArray();
  if (!records.length) return res.status(404).json({ message: 'No certificates found' });
  const settings = await collections.settings.findOne({ key: 'organization' }) || {};
  const event = await collections.events.findOne({ _id: toId(req.params.eventId) });
  const archive = new ZipArchive('zip');
  res.attachment(event ? `${event.event_name.replace(/[^a-zA-Z0-9]/g,'_')}_Certificates.zip` : 'certificates.zip');
  archive.pipe(res);
  for (const rec of records) {
    try { const pdf = await generatePDF(rec, settings); archive.append(pdf, { name: `${rec.student_name.replace(/[^a-zA-Z0-9]/g,'_')}_${rec.certificate_id}.pdf` }); } catch {}
  }
  await archive.finalize();
});

app.post('/api/certificates/:certificateId/revoke', auth, async (req, res) => {
  await connectDB();
  const rec = await collections.certificates.findOne({ certificate_id: safe(req.params.certificateId) });
  if (!rec) return res.status(404).json({ message: 'Certificate not found' });
  await collections.certificates.updateOne({ certificate_id: rec.certificate_id }, { $set: { status: 'revoked' } });
  res.json({ ok: true });
});

// ===== VERIFICATION (public) =====
app.get('/api/verify/:certificateId', async (req, res) => {
  await connectDB();
  const rec = await collections.certificates.findOne({ certificate_id: safe(req.params.certificateId) });
  if (!rec) return res.status(404).json({ message: 'Certificate not found' });
  res.json({ certificate_id: rec.certificate_id, student_name: rec.student_name, event_name: rec.event_name, event_date: rec.event_date, certificate_type: rec.certificate_type, department: rec.department, year: rec.year, position: rec.position, status: rec.status, issued_by: 'Microsoft AI Club', institution: 'Meenakshi Sundararajan Engineering College' });
});

// ===== DASHBOARD =====
app.get('/api/dashboard/stats', auth, async (_, res) => {
  try {
    await connectDB();
    res.json({ totalEvents: await collections.events.countDocuments({}), totalCertificates: await collections.certificates.countDocuments({}), participationCount: await collections.certificates.countDocuments({ certificate_type: 'participation' }), winnerCount: await collections.certificates.countDocuments({ certificate_type: 'winner' }) });
  } catch { res.status(500).json({ message: 'Failed to load stats' }); }
});

export default app;
