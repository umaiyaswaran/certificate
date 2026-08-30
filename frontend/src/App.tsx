import { useEffect, useRef, useState } from 'react';
import { Award, CalendarDays, Check, ChevronRight, CloudUpload, Download, FileSpreadsheet, FileText, Home, LogOut, Menu, Settings, ShieldCheck, Sparkles, Trophy, Upload, Users, X, Trash2, Plus, AlertCircle, CheckCircle, XCircle, Medal } from 'lucide-react';

type Page = 'dashboard' | 'generate' | 'events' | 'settings';
type CertType = 'participation' | 'winner';

interface Event {
  _id: string;
  event_name: string;
  event_date: string;
  certificate_type: CertType;
  certificate_count: number;
  created_at: string;
}

interface Participant {
  _id: string;
  event_id: string;
  student_name: string;
  department: string;
  year: string;
  position: string | null;
}

interface Signatory {
  _id: string;
  name: string;
  role: string;
  signature_image: string;
}

interface Certificate {
  _id: string;
  certificate_id: string;
  event_id: string;
  student_name: string;
  certificate_type: CertType;
  event_name: string;
  event_date: string;
  department: string;
  year: string;
  position: string | null;
  status: string;
  created_at: string;
}

interface Stats {
  totalEvents: number;
  totalCertificates: number;
  participationCount: number;
  winnerCount: number;
}

interface VerificationResult {
  certificate_id: string;
  student_name: string;
  event_name: string;
  event_date: string;
  certificate_type: string;
  department: string;
  year: string;
  position: string | null;
  status: string;
  issued_by: string;
  institution: string;
}

const api = {
  fetch: async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const token = localStorage.getItem('cg_token');
    const res = await fetch(input, {
      ...init,
      headers: {
        ...(init.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });

    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem('cg_token');
        window.location.reload();
      }
      const text = await res.text();
      throw new Error(text || 'Request failed');
    }

    return res;
  },
  get: async (url: string) => {
    const res = await api.fetch(url);
    const contentType = res.headers.get('content-type') || '';
    return contentType.includes('application/json') ? res.json() : [];
  },
  post: async (url: string, body?: unknown) => {
    const res = await api.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return res.json();
  },
  put: async (url: string, body?: unknown) => {
    const res = await api.fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return res.json();
  },
  delete: async (url: string) => {
    const res = await api.fetch(url, { method: 'DELETE' });
    const contentType = res.headers.get('content-type') || '';
    return contentType.includes('application/json') ? res.json() : { ok: true };
  },
  upload: async (url: string, form: FormData) => {
    const res = await api.fetch(url, { method: 'POST', body: form });
    return res.json();
  }
};

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [token, setToken] = useState(localStorage.getItem('cg_token'));

  const navigate = (next: Page) => { setPage(next); setMobileOpen(false); };

  if (!token) return <Login onLogin={(t) => { localStorage.setItem('cg_token', t); setToken(t); }} />;

  return (
    <div className="app-shell">
      <aside className={mobileOpen ? 'sidebar open' : `sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Sparkles size={16} /></div>
          <div>
            <strong>MICROSOFT AI</strong>
            <span>CLUB · CERTIFICATES</span>
          </div>
        </div>
        <div className="section-label">WORKSPACE</div>
        <nav>
          {([
            ['dashboard', 'Dashboard', Home],
            ['generate', 'Generate Certificates', Award],
            ['events', 'Event History', CalendarDays],
            ['settings', 'Settings', Settings]
          ] as const).map(([id, label, Icon]) => (
            <button key={id} className={page === id ? 'nav-item active' : 'nav-item'} onClick={() => navigate(id)}>
              <Icon size={17} />
              <span>{label}</span>
              {page === id && <ChevronRight size={14} className="nav-arrow" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="nav-item" onClick={() => { localStorage.removeItem('cg_token'); setToken(null); }}>
            <LogOut size={17} />
            <span>Log out</span>
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => { if (window.innerWidth <= 768) setMobileOpen(!mobileOpen); else setCollapsed(!collapsed); }}>
            <Menu size={20} />
          </button>
          <div className="crumb">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <b>{page === 'dashboard' ? 'Dashboard' : page === 'generate' ? 'Generate Certificates' : page === 'events' ? 'Event History' : 'Settings'}</b>
          </div>
          <div className="top-actions">
            <div className="avatar">AD</div>
          </div>
        </header>
        {page === 'dashboard' && <Dashboard onGenerate={() => navigate('generate')} />}
        {page === 'generate' && <Generator />}
        {page === 'events' && <Events />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) { setError('Please enter username and password'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Login failed'); setLoading(false); return; }
      onLogin(data.access_token);
    } catch { setError('Connection failed. Is the backend running?'); setLoading(false); }
  };

  return (
    <div className="login-page">
      <div className="login-left">
        <div className="login-panel">
          <div className="login-brand">
            <div className="brand-mark"><Sparkles size={16} /></div>
            <div>
              <strong>MICROSOFT AI</strong>
              <span>CLUB · CERTIFICATES</span>
            </div>
          </div>
          <div className="login-copy">
            <p className="eyebrow">PRIVATE ADMIN PORTAL</p>
            <h1>Make every achievement<br />worth remembering.</h1>
            <p>Generate print-ready certificates for the people shaping tomorrow with AI.</p>
          </div>
          <div className="login-card">
            {error && <div className="login-error"><AlertCircle size={14} /> {error}</div>}
            <div className="form-group">
              <label>Username</label>
              <input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} placeholder="Enter username" />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} placeholder="Enter password" />
            </div>
            <button className="primary-button full" onClick={handleLogin} disabled={loading}>
              {loading ? 'Signing in...' : 'Enter workspace'} <ChevronRight size={16} />
            </button>
            <div className="login-footer"><ShieldCheck size={14} /> Secure coordinator access</div>
          </div>
        </div>
      </div>
      <div className="login-right">
        <div className="login-art">
          <div className="art-icon"><Award size={48} /></div>
          <h2>Honouring<br />Brilliance</h2>
          <p>Design and issue beautiful certificates in minutes.</p>
          <div className="college-name">
            <strong>MEENAKSHI SUNDARARAJAN</strong>
            ENGINEERING COLLEGE
          </div>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ onGenerate }: { onGenerate: () => void }) {
  const [stats, setStats] = useState<Stats>({ totalEvents: 0, totalCertificates: 0, participationCount: 0, winnerCount: 0 });
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    api.get('/api/dashboard/stats').then((data) => {
      if (data && typeof data === 'object') setStats(data as Stats);
    }).catch(() => {});

    api.get('/api/events').then((data) => {
      setEvents(Array.isArray(data) ? data as Event[] : []);
    }).catch(() => {});
  }, []);

  return (
    <div className="content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WELCOME BACK</p>
          <h1>Admin Dashboard</h1>
          <p className="subheading">Your certificate workspace is ready when you are.</p>
        </div>
        <button className="primary-button" onClick={onGenerate}><Award size={16} /> Create Certificates <ChevronRight size={15} /></button>
      </div>

      <section className="hero-banner">
        <div>
          <p className="eyebrow">MICROSOFT AI CLUB</p>
          <h2>Celebrate the work<br />that moves us forward.</h2>
          <p>Design and issue beautiful certificates in minutes.</p>
          <button className="ghost-button" onClick={onGenerate}>Start a new batch <ChevronRight size={14} /></button>
        </div>
        <div className="hero-emblem"><Sparkles size={20} /><span>AI</span><small>EXCELLENCE</small></div>
      </section>

      <div className="section-title">
        <div><h2>At a glance</h2><p>Certificate activity across your workspace</p></div>
      </div>
      <div className="metrics">
        <Metric icon={CalendarDays} label="Total events" value={String(stats.totalEvents)} tone="blue" />
        <Metric icon={FileText} label="Certificates issued" value={String(stats.totalCertificates)} tone="gold" />
        <Metric icon={Users} label="Participation" value={String(stats.participationCount)} tone="mint" />
        <Metric icon={Trophy} label="Winner awards" value={String(stats.winnerCount)} tone="coral" />
      </div>

      <section>
        <div className="section-title">
          <div><h2>Recent events</h2><p>Your latest certificate batches</p></div>
        </div>
        {events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><CalendarDays size={40} /></div>
            <h3>No events yet</h3>
            <p>Create your first certificate batch to get started.</p>
            <button className="primary-button" onClick={onGenerate}><Award size={16} /> Create Certificate</button>
          </div>
        ) : (
          <div className="event-list">
            {events.slice(0, 5).map(e => (
              <EventRow key={e._id} event={e} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Award; label: string; value: string; tone: string }) {
  return (
    <div className="metric">
      <div className={`metric-icon ${tone}`}><Icon size={18} /></div>
      <div className="metric-info">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function EventRow({ event }: { event: Event }) {
  const typeColor = event.certificate_type === 'winner' ? 'gold' : 'blue';
  const date = new Date(event.event_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <div className="event-row">
      <div className={`event-icon ${typeColor}`}>
        {event.certificate_type === 'winner' ? <Trophy size={18} /> : <Award size={18} />}
      </div>
      <div className="event-main">
        <strong>{event.event_name}</strong>
        <span><CalendarDays size={12} /> {date}</span>
      </div>
      <div className="event-count">
        <strong>{event.certificate_count}</strong>
        <span>certificates</span>
      </div>
    </div>
  );
}

function Stepper({ active = 1 }: { active?: number }) {
  return (
    <div className="stepper">
      {['Event', 'Excel', 'Signatories', 'Preview', 'Generate'].map((x, i) => (
        <div className={i + 1 < active ? 'step done' : i + 1 === active ? 'step active' : 'step'} key={x}>
          <div className="step-circle">{i + 1 < active ? <Check size={14} /> : i + 1}</div>
          <span>{x}</span>
          {i < 4 && <div className="step-line" />}
        </div>
      ))}
    </div>
  );
}

function Generator() {
  const [step, setStep] = useState(1);
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [certType, setCertType] = useState<CertType>('participation');
  const [eventId, setEventId] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);
  const [uploaded, setUploaded] = useState(false);
  const [signatories, setSignatories] = useState<Signatory[]>([]);
  const [selectedSignatories, setSelectedSignatories] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [generated, setGenerated] = useState<{ certificate_id: string; filename: string; student_name: string }[]>([]);
  const [toast, setToast] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get('/api/signatories').then((items: Signatory[]) => { setSignatories(items); setSelectedSignatories(new Set(items.map(item => item._id))); }).catch(() => {});
  }, []);

  const downloadTemplate = async () => {
    const res = await api.fetch(`/api/templates/${certType}`);
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${certType}_template.xlsx`;
    link.click();
  };

  const createEvent = async () => {
    if (!eventName || !eventDate) { setToast('Please fill event name and date'); return; }
    try {
      const data = await api.post('/api/events', { event_name: eventName, event_date: eventDate, certificate_type: certType });
      if (data.id) { setEventId(data.id); setStep(2); }
      else { setToast(data.message || 'Failed to create event'); }
    } catch { setToast('Failed to create event'); }
  };

  const uploadExcel = async (file: File) => {
    if (!eventId) return;
    const form = new FormData();
    form.append('file', file);
    form.append('certificate_type', certType);
    try {
      const data = await api.upload(`/api/events/${eventId}/participants/upload`, form);
      if (data.errors) { setErrors(data.errors); setToast('Validation errors found'); return; }
      if (data.participants) {
        setParticipants(data.participants);
        setSelectedParticipants(new Set(data.participants.map((p: Participant) => p._id)));
        setUploaded(true);
        setErrors([]);
        setStep(3);
      }
    } catch { setToast('Upload failed'); }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) uploadExcel(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadExcel(file);
  };

  const toggleParticipant = (id: string) => {
    const next = new Set(selectedParticipants);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedParticipants(next);
  };

  const toggleAllParticipants = () => {
    if (selectedParticipants.size === participants.length) {
      setSelectedParticipants(new Set());
    } else {
      setSelectedParticipants(new Set(participants.map(p => p._id)));
    }
  };

  const toggleSignatory = (id: string) => {
    const next = new Set(selectedSignatories);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedSignatories(next);
  };

  const generateCertificates = async () => {
    if (!eventId || selectedParticipants.size === 0) return;
    setGenerating(true);
    setProgress({ current: 0, total: selectedParticipants.size });

    try {
      const data = await api.post(`/api/events/${eventId}/certificates/generate`, {
        participant_ids: Array.from(selectedParticipants),
        signatory_ids: Array.from(selectedSignatories)
      });
      if (data.certificates) {
        setGenerated(data.certificates);
        setProgress({ current: data.count, total: data.count });
        setStep(5);
        setToast(`${data.count} certificates generated successfully`);
      } else {
        setToast(data.message || 'Generation failed');
      }
    } catch { setToast('Certificate generation failed'); }
    setGenerating(false);
  };

  const downloadZip = async () => {
    if (!eventId) return;
    const res = await api.fetch(`/api/events/${eventId}/certificates/zip`);
    if (!res.ok) { setToast('No certificates to download'); return; }
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${eventName.replace(/[^a-zA-Z0-9]/g, '_')}_Certificates.zip`;
    link.click();
  };

  const downloadSingle = async (certId: string, studentName: string) => {
    const res = await api.fetch(`/api/certificates/${certId}/download`);
    if (!res.ok) return;
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${studentName.replace(/[^a-zA-Z0-9]/g, '_')}_${certId}.pdf`;
    link.click();
  };

  return (
    <div className="content">
      <div className="page-heading compact">
        <div>
          <p className="eyebrow">NEW CERTIFICATE BATCH</p>
          <h1>Generate certificates</h1>
          <p className="subheading">A simple path from spreadsheet to something worth keeping.</p>
        </div>
      </div>
      <Stepper active={step} />

      {toast && (
        <div className={toast.includes('success') ? 'alert success' : 'alert error'}>
          {toast.includes('success') ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {toast}
          <button onClick={() => setToast('')} className="icon-button"><X size={14} /></button>
        </div>
      )}

      {/* Step 1: Event Details */}
      {step === 1 && (
        <div className="surface">
          <div className="surface-heading">
            <span className="number">01</span>
            <div><h2>Event details</h2><p>Set the context for this certificate batch.</p></div>
          </div>
          <div className="form-group">
            <label>Event name</label>
            <input value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g. AI Innovation Challenge 2026" />
          </div>
          <div className="form-group">
            <label>Event date</label>
            <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Certificate type</label>
            <select value={certType} onChange={e => setCertType(e.target.value as CertType)}>
              <option value="participation">Participation</option>
              <option value="winner">Winner</option>
            </select>
          </div>
          <button className="primary-button" onClick={createEvent}>Continue <ChevronRight size={15} /></button>
        </div>
      )}

      {/* Step 2: Excel Upload */}
      {step === 2 && (
        <div className="surface">
          <div className="surface-heading">
            <span className="number">02</span>
            <div><h2>Upload participant data</h2><p>Download the template, fill in student details, then upload.</p></div>
          </div>
          <button className="secondary-button" onClick={downloadTemplate}>
            <FileSpreadsheet size={15} /> Download {certType === 'winner' ? 'Winner' : 'Participation'} Template
          </button>
          <div
            className={`upload-zone ${uploaded ? 'uploaded' : ''}`}
            onDragOver={e => e.preventDefault()}
            onDrop={handleFileDrop}
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFileSelect} />
            <div className="upload-icon">{uploaded ? <CheckCircle size={32} /> : <CloudUpload size={32} />}</div>
            {uploaded ? (
              <p>{participants.length} students detected</p>
            ) : (
              <>
                <p>Drag and drop your Excel file here, or click to browse</p>
                <small>Supports .xlsx and .xls files</small>
              </>
            )}
          </div>
          {errors.length > 0 && (
            <div className="error-list">
              {errors.map((e, i) => (
                <div className="error-item" key={i}><AlertCircle size={14} /> <span className="error-row">Row {e.row}</span> {e.message}</div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
            <button className="secondary-button" onClick={() => setStep(1)}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /> Back</button>
          </div>
        </div>
      )}

      {/* Step 3: Signatories */}
      {step === 3 && (
        <div className="surface">
          <div className="surface-heading">
            <span className="number">03</span>
            <div><h2>Select signatories</h2><p>Choose who will sign this certificate batch.</p></div>
          </div>
          {signatories.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><Users size={32} /></div>
              <h3>No signatories saved</h3>
              <p>Add signatories in Settings first.</p>
            </div>
          ) : (
            <div className="sig-selector">
              {signatories.map(sig => (
                <label className={`sig-option ${selectedSignatories.has(sig._id) ? 'selected' : ''}`} key={sig._id}>
                  <input type="checkbox" checked={selectedSignatories.has(sig._id)} onChange={() => toggleSignatory(sig._id)} />
                  <div className="sig-avatar">
                    <img src={`/api/assets/signature/${sig._id}`} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} alt="" />
                  </div>
                  <div className="sig-details"><strong>{sig.name}</strong><small>{sig.role}</small></div>
                </label>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
            <button className="secondary-button" onClick={() => setStep(2)}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /> Back</button>
            <button className="primary-button" onClick={() => setStep(4)}>Continue <ChevronRight size={15} /></button>
          </div>
        </div>
      )}

      {/* Step 4: Preview & Select */}
      {step === 4 && (
        <>
          <div className="surface">
            <div className="surface-heading">
              <span className="number">04</span>
              <div><h2>Preview participants</h2><p>Select students for certificate generation.</p></div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="secondary-button" onClick={toggleAllParticipants}>
                {selectedParticipants.size === participants.length ? 'Unselect All' : 'Select All'}
              </button>
              <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
                {selectedParticipants.size} of {participants.length} selected
              </span>
            </div>
            <div className="checkbox-list">
              {participants.map(p => (
                <label className={`checkbox-item ${selectedParticipants.has(p._id) ? 'selected' : ''}`} key={p._id}>
                  <input type="checkbox" checked={selectedParticipants.has(p._id)} onChange={() => toggleParticipant(p._id)} />
                  <div className="item-info">
                    <strong>{p.student_name}</strong>
                    <small>{p.department} · Year {p.year}{p.position ? ` · ${p.position}` : ''}</small>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="surface">
            <div className="surface-heading">
              <span className="number">05</span>
              <div><h2>Certificate preview</h2><p>How the certificate will look.</p></div>
            </div>
            <CertificatePreview type={certType} eventName={eventName} eventDate={eventDate} participant={participants[0]} signatories={signatories.filter(s => selectedSignatories.has(s._id))} />
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <button className="secondary-button" onClick={() => setStep(3)}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /> Back</button>
            <button className="primary-button gold" onClick={generateCertificates} disabled={generating || selectedParticipants.size === 0}>
              {generating ? 'Generating...' : `Generate ${selectedParticipants.size} Certificate${selectedParticipants.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}

      {/* Step 5: Done */}
      {step === 5 && (
        <div className="surface">
          <div className="surface-heading">
            <span className="number"><Check size={16} /></span>
            <div><h2>Certificates generated</h2><p>{generated.length} certificate{generated.length !== 1 ? 's' : ''} created successfully.</p></div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
            <button className="primary-button" onClick={downloadZip}><Download size={15} /> Download All (ZIP)</button>
          </div>
          <div className="checkbox-list">
            {generated.map(cert => (
              <div className="checkbox-item" key={cert.certificate_id} style={{ cursor: 'default' }}>
                <FileText size={16} style={{ color: 'var(--accent)' }} />
                <div className="item-info">
                  <strong>{cert.student_name}</strong>
                  <small>{cert.certificate_id}</small>
                </div>
                <button className="secondary-button" onClick={() => downloadSingle(cert.certificate_id, cert.student_name)}>
                  <Download size={13} /> PDF
                </button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 'var(--space-lg)' }}>
            <button className="secondary-button" onClick={() => { setStep(1); setGenerated([]); setParticipants([]); setUploaded(false); }}>Create Another Batch</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CertificatePreview({ type, eventName, eventDate, participant, signatories: sigs }: { type: CertType; eventName: string; eventDate: string; participant?: Participant; signatories: Signatory[] }) {
  const p = participant || { student_name: 'Umaiyasawaran S', department: 'Artificial Intelligence and Data Science', year: 'III', position: '1st Place' };
  
  const dateStr = eventDate 
    ? new Date(`${eventDate}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div className="cert-preview-wrapper">
      <div className="cert-preview">
        {/* Vector circuit traces overlay */}
        <svg className="cert-circuits" viewBox="0 0 842 595" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}>
          <g stroke="rgba(200, 149, 75, 0.25)" strokeWidth="1" fill="none">
            {/* Left Circuit Traces */}
            <path d="M 34,180 L 70,216 L 70,360 L 45,385" />
            <circle cx="45" cy="385" r="2.5" fill="rgba(200, 149, 75, 0.25)" />
            <path d="M 34,250 L 55,271 L 55,320" />
            <circle cx="55" cy="320" r="2.5" fill="rgba(200, 149, 75, 0.25)" />
            <path d="M 34,430 L 85,379 L 85,280" />
            <circle cx="85" cy="280" r="2.5" fill="rgba(200, 149, 75, 0.25)" />
            
            {/* Right Circuit Traces */}
            <path d="M 808,180 L 772,216 L 772,360 L 797,385" />
            <circle cx="797" cy="385" r="2.5" fill="rgba(200, 149, 75, 0.25)" />
            <path d="M 808,250 L 787,271 L 787,320" />
            <circle cx="787" cy="320" r="2.5" fill="rgba(200, 149, 75, 0.25)" />
            <path d="M 808,430 L 757,379 L 757,280" />
            <circle cx="757" cy="280" r="2.5" fill="rgba(200, 149, 75, 0.25)" />
          </g>
        </svg>

        <div className="preview-corner corner-tl" /><div className="preview-corner corner-br" />
        <div className="cert-border" />
        <div className="cert-inner-border" />
        <div className="cert-watermark"><img src="/api/assets/logo/club" alt="" /></div>
        
        <div className="cert-header">
          <div className="cert-header-main">
            <div className="cert-logo-left">
              <img className="preview-college-logo" src="/api/assets/logo/college" alt="College logo" />
            </div>
            <div className="cert-header-center">
              <h3>MEENAKSHI SUNDARARAJAN<br />ENGINEERING COLLEGE</h3>
              <div className="autonomous">(An Autonomous Institution) | Managed by IIEI Society</div>
              <div className="address-line">Approved by AICTE, New Delhi | Affiliated to Anna University, Chennai</div>
              <div className="address-line">A Recognized Research Center by Anna University</div>
              <div className="dept">DEPARTMENT OF ARTIFICIAL INTELLIGENCE & DATA SCIENCE</div>
            </div>
            <div className="cert-logo-right">
              <img className="preview-club-logo" src="/api/assets/logo/club" alt="Club logo" />
            </div>
          </div>

          <div className="cert-club-banner">MICROSOFT AI CLUB</div>
          <div className="autonomous tag-line">INNOVATE • ANALYZE • CONNECT</div>
        </div>

        <div className="cert-title">
          <h2>CERTIFICATE</h2>
          <div className="cert-subtitle-row">
            <div className="cert-subtitle-line" />
            <div className="cert-subtitle-banner">
              OF {type === 'winner' ? 'ACHIEVEMENT' : 'PARTICIPATION'}
            </div>
            <div className="cert-subtitle-line" />
          </div>
        </div>

        <div className="cert-presented">PROUDLY PRESENTED TO</div>
        <div className="cert-name">{p.student_name}</div>

        <div className="cert-name-underline-row">
          <div className="cert-name-underline-line" />
          <div className="cert-name-underline-diamond" />
          <div className="cert-name-underline-line" />
        </div>

        {type === 'winner' && p.position && <div className="cert-position">{p.position.toUpperCase()}</div>}

        <div className="cert-body">
          {type === 'winner' && p.position ? (
            <>This certificate is proudly presented to <b>{p.student_name}</b>, of the Department of <b>{p.department}</b>, Year <b>{p.year}</b>, in recognition of securing <b>{p.position}</b> in <b>{eventName || 'Event name'}</b>.</>
          ) : (
            <>This certificate is proudly presented to <b>{p.student_name}</b>, of the Department of <b>{p.department}</b>, Year <b>{p.year}</b>, in recognition of their successful participation in <b>{eventName || 'Event name'}</b>.</>
          )}
        </div>

        <div className="cert-date">Event held on {dateStr}.</div>

        <div className={`cert-signatures count-${Math.min(sigs.length, 4)}`}>
          {sigs.length > 0 ? sigs.map((s, i) => (
            <div className="cert-sig" key={i}>
              <img className="sig-image" src={`/api/assets/signature/${s._id}`} alt="Signature" />
              <div className="sig-line" />
              <div className="sig-name">{s.name}</div>
              <div className="sig-role">{s.role}</div>
            </div>
          )) : (
            <div className="cert-no-signatures">Select saved signatories to place their actual signatures here.</div>
          )}
        </div>

        <div className="cert-footer">
          <Medal className="footer-medal" size={22} />
          <div className="footer-content">
            <div className="footer-brand">MICROSOFT AI CLUB</div>
            <div className="footer-sub">INNOVATE • ANALYZE • CONNECT</div>
          </div>
          <Medal className="footer-medal" size={22} />
        </div>
      </div>
    </div>
  );
}

function Events() {
  const [events, setEvents] = useState<Event[]>([]);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => { api.get('/api/events').then(setEvents).catch(() => {}); }, []);

  const deleteEvent = async (id: string) => {
    if (!confirm('Delete this event and all its certificates?')) return;
    await api.delete(`/api/events/${id}`);
    setEvents(events.filter(e => e._id !== id));
    setToast('Event deleted');
  };

  const filtered = events.filter(e => e.event_name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="content">
      <div className="page-heading compact">
        <div>
          <p className="eyebrow">ARCHIVE</p>
          <h1>Event history</h1>
          <p className="subheading">Every batch, beautifully accounted for.</p>
        </div>
      </div>
      {toast && <div className="alert success"><CheckCircle size={14} /> {toast}<button onClick={() => setToast('')} style={{ marginLeft: 'auto' }}><X size={14} /></button></div>}
      <div className="toolbar">
        <input className="search-box" placeholder="Search events..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><CalendarDays size={40} /></div>
          <h3>No events found</h3>
          <p>Create your first certificate batch to see it here.</p>
        </div>
      ) : (
        <div className="history-table">
          <div className="table-head">
            <span>Event</span><span>Date</span><span>Type</span><span>Issued</span><span />
          </div>
          {filtered.map(e => (
            <div className="table-row" key={e._id}>
              <div className="event-main"><strong>{e.event_name}</strong><span>Created {new Date(e.created_at).toLocaleDateString()}</span></div>
              <span>{new Date(e.event_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              <span className={e.certificate_type === 'winner' ? 'tag gold-tag' : 'tag blue-tag'}>{e.certificate_type}</span>
              <strong>{e.certificate_count}</strong>
              <button className="icon-button" onClick={() => deleteEvent(e._id)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPage() {
  const [settings, setSettings] = useState<any>({});
  const [signatories, setSignatories] = useState<Signatory[]>([]);
  const [toast, setToast] = useState('');
  const [showAddSig, setShowAddSig] = useState(false);

  useEffect(() => {
    api.get('/api/settings').then(setSettings).catch(() => {});
    api.get('/api/signatories').then(setSignatories).catch(() => {});
  }, []);

  const saveSettings = async () => {
    await api.put('/api/settings', settings);
    setToast('Settings saved');
  };

  const uploadLogo = async (type: 'college' | 'club', file: File) => {
    const form = new FormData();
    form.append('file', file);
    await api.upload(`/api/assets/logo/${type}`, form);
    setToast(`${type === 'college' ? 'College' : 'Club'} logo uploaded`);
  };

  const deleteSignatory = async (id: string) => {
    await api.delete(`/api/signatories/${id}`);
    setSignatories(signatories.filter(s => s._id !== id));
    setToast('Signatory deleted');
  };

  return (
    <div className="content">
      <div className="page-heading compact">
        <div>
          <p className="eyebrow">WORKSPACE CONFIGURATION</p>
          <h1>Settings</h1>
          <p className="subheading">Configure your certificate workspace.</p>
        </div>
        <button className="primary-button" onClick={saveSettings}><Check size={15} /> Save changes</button>
      </div>
      {toast && <div className="alert success"><CheckCircle size={14} /> {toast}<button onClick={() => setToast('')} style={{ marginLeft: 'auto' }}><X size={14} /></button></div>}

      <div className="settings-grid">
        <section className="surface">
          <div className="surface-heading">
            <span className="number">01</span>
            <div><h2>Organization</h2><p>Details that appear on every certificate.</p></div>
          </div>
          <div className="form-group">
            <label>College name</label>
            <input value={settings.college_name || ''} onChange={e => setSettings({ ...settings, college_name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Department name</label>
            <input value={settings.department_name || ''} onChange={e => setSettings({ ...settings, department_name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Club name</label>
            <input value={settings.club_name || ''} onChange={e => setSettings({ ...settings, club_name: e.target.value })} />
          </div>
        </section>

        <section className="surface">
          <div className="surface-heading">
            <span className="number">02</span>
            <div><h2>Logo assets</h2><p>Uploaded artwork stored by the backend.</p></div>
          </div>
          <LogoUpload label="College logo" type="college" onChange={(f) => f && uploadLogo('college', f)} />
          <LogoUpload label="Club logo" type="club" onChange={(f) => f && uploadLogo('club', f)} />
        </section>

        <section className="surface">
          <div className="surface-heading">
            <span className="number">03</span>
            <div><h2>Certificate settings</h2><p>Configure ID prefix and watermark.</p></div>
          </div>
          <div className="form-group">
            <label>Certificate ID prefix</label>
            <input value={settings.certificate_prefix || ''} onChange={e => setSettings({ ...settings, certificate_prefix: e.target.value })} />
          </div>
          <div className="two-fields">
            <div className="form-group">
              <label>Watermark opacity</label>
              <input type="number" step="0.01" min="0" max="1" value={settings.watermark_opacity || 0.07} onChange={e => setSettings({ ...settings, watermark_opacity: parseFloat(e.target.value) })} />
            </div>
            <div className="form-group">
              <label>Watermark size</label>
              <select value={settings.watermark_size || 'large'} onChange={e => setSettings({ ...settings, watermark_size: e.target.value })}>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </div>
          </div>
        </section>

        <section className="surface full-width">
          <div className="surface-heading">
            <span className="number">04</span>
            <div><h2>Certificate signatories</h2><p>Manage people who sign certificates.</p></div>
          </div>
          <button className="primary-button" onClick={() => setShowAddSig(true)}><Plus size={15} /> Add Signatory</button>
          {signatories.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><Users size={32} /></div>
              <h3>No signatories</h3>
              <p>Add a signatory to get started.</p>
            </div>
          ) : (
            signatories.map(sig => (
              <div className="signatory-card" key={sig._id}>
                <div className="sig-preview">
                  <img src={`/api/assets/signature/${sig._id}`} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} alt="" />
                </div>
                <div className="sig-info"><strong>{sig.name}</strong><small>{sig.role}</small></div>
                <div className="sig-actions">
                  <button className="icon-button" onClick={() => deleteSignatory(sig._id)}><Trash2 size={15} /></button>
                </div>
              </div>
            ))
          )}
        </section>
      </div>

      {showAddSig && <AddSignatoryModal onClose={() => setShowAddSig(false)} onAdded={(s) => { setSignatories([s, ...signatories]); setShowAddSig(false); setToast('Signatory added'); }} />}
    </div>
  );
}

function LogoUpload({ label, type, onChange }: { label: string; type: string; onChange: (file?: File) => void }) {
  const [preview, setPreview] = useState(`/api/assets/logo/${type}?v=${Date.now()}`);
  return (
    <div className="asset-upload">
      <div className="asset-preview">
        <img src={preview} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} alt="" />
      </div>
      <div className="asset-info"><strong>{label}</strong><small>PNG or JPG · max 5MB</small></div>
      <label className="secondary-button" style={{ cursor: 'pointer' }}>
        <Upload size={14} /> Upload
        <input type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} onChange={e => {
          const file = e.target.files?.[0];
          if (file) { onChange(file); setPreview(URL.createObjectURL(file)); }
        }} />
      </label>
    </div>
  );
}

function AddSignatoryModal({ onClose, onAdded }: { onClose: () => void; onAdded: (s: Signatory) => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [signature, setSignature] = useState<File>();
  const [signaturePreview, setSignaturePreview] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name || !role || !signature) return;
    setSaving(true);
    const form = new FormData();
    form.append('name', name);
    form.append('role', role);
    form.append('signature', signature);
    try {
      const data = await api.upload('/api/signatories', form);
      if (data._id) onAdded(data);
    } catch {}
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Signatory</h2>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Dr. K. J. Sreedevi" />
          </div>
          <div className="form-group">
            <label>Role</label>
            <input value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Faculty Coordinator" />
          </div>
          <div className="form-group">
            <label>Signature image</label>
            <label className="signature-upload-button">
              <Upload size={15} /> {signature ? signature.name : 'Upload JPG signature'}
              <input type="file" accept=".jpg,.jpeg,image/jpeg" onChange={e => { const file = e.target.files?.[0]; if (file) { setSignature(file); setSignaturePreview(URL.createObjectURL(file)); } }} />
            </label>
            {signaturePreview && <img className="signature-upload-preview" src={signaturePreview} alt="Signature preview" />}
          </div>
        </div>
        <div className="modal-footer">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={save} disabled={saving || !name || !role || !signature}>
            {saving ? 'Saving...' : 'Save signatory'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Verification page (public route)
export function VerificationPage() {
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const certId = window.location.pathname.split('/verify/')[1];

  useEffect(() => {
    if (!certId) return;
    fetch(`/api/verify/${certId}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setResult)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [certId]);

  if (loading) return <div className="verify-page"><div className="verify-card"><div className="verify-header valid"><div className="verify-icon"><ShieldCheck size={36} /></div><h1>VERIFYING...</h1></div></div></div>;

  if (notFound) return (
    <div className="verify-page">
      <div className="verify-card">
        <div className="verify-header not-found">
          <div className="verify-icon"><XCircle size={36} /></div>
          <h1>CERTIFICATE NOT FOUND</h1>
          <p>The certificate ID could not be verified.</p>
        </div>
        <div className="verify-footer"><p>Microsoft AI Club · Meenakshi Sundararajan Engineering College</p></div>
      </div>
    </div>
  );

  if (result?.status === 'revoked') return (
    <div className="verify-page">
      <div className="verify-card">
        <div className="verify-header revoked">
          <div className="verify-icon"><XCircle size={36} /></div>
          <h1>CERTIFICATE REVOKED</h1>
          <p>This certificate has been revoked.</p>
        </div>
        <div className="verify-footer"><p>Microsoft AI Club · Meenakshi Sundararajan Engineering College</p></div>
      </div>
    </div>
  );

  return (
    <div className="verify-page">
      <div className="verify-card">
        <div className="verify-header valid">
          <div className="verify-icon"><CheckCircle size={36} /></div>
          <h1>CERTIFICATE VERIFIED</h1>
          <p>This certificate is authentic and valid.</p>
        </div>
        <div className="verify-body">
          <div className="verify-row"><span className="label">Certificate ID</span><span className="value">{result?.certificate_id}</span></div>
          <div className="verify-row"><span className="label">Recipient</span><span className="value">{result?.student_name}</span></div>
          <div className="verify-row"><span className="label">Event</span><span className="value">{result?.event_name}</span></div>
          <div className="verify-row"><span className="label">Certificate Type</span><span className="value">{result?.certificate_type === 'winner' ? 'Certificate of Achievement' : 'Certificate of Participation'}</span></div>
          <div className="verify-row"><span className="label">Department</span><span className="value">{result?.department}</span></div>
          <div className="verify-row"><span className="label">Year</span><span className="value">{result?.year}</span></div>
          {result?.position && <div className="verify-row"><span className="label">Position</span><span className="value">{result.position}</span></div>}
          <div className="verify-row"><span className="label">Event Date</span><span className="value">{result?.event_date}</span></div>
          <div className="verify-row"><span className="label">Issued By</span><span className="value">{result?.issued_by}</span></div>
          <div className="verify-row"><span className="label">Institution</span><span className="value">{result?.institution}</span></div>
          <div className="verify-row"><span className="label">Status</span><span className="value" style={{ color: '#10b981' }}>VALID</span></div>
        </div>
        <div className="verify-footer"><p>Microsoft AI Club · Meenakshi Sundararajan Engineering College</p></div>
      </div>
    </div>
  );
}

export default App;
