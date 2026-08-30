import { useState } from 'react';
import { Check, Upload } from 'lucide-react';

export default function SignatoryManager() {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [signature, setSignature] = useState<File>();
  const [saved, setSaved] = useState<{ name: string; role: string }[]>([]);
  const submit = async () => {
    if (!name || !role || !signature) return;
    const form = new FormData(); form.append('name', name); form.append('role', role); form.append('signature', signature);
    const response = await fetch('/api/signatories', { method: 'POST', body: form });
    if (response.ok) { setSaved([...saved, { name, role }]); setName(''); setRole(''); setSignature(undefined); }
  };
  return <section className="surface signatory-manager"><div className="surface-heading"><span className="number">03</span><div><h2>Certificate signatories</h2><p>Enter a name, role, and JPG signature image once for reuse.</p></div></div><div className="two-fields"><label>Name<input value={name} onChange={event => setName(event.target.value)} placeholder="Dr. K. J. Sreedevi" /></label><label>Role<input value={role} onChange={event => setRole(event.target.value)} placeholder="Faculty Coordinator" /></label></div><label className="signature-drop"><Upload size={18} /><span>{signature ? signature.name : 'Upload JPG signature image'}</span><input type="file" accept=".jpg,.jpeg,image/jpeg" onChange={event => setSignature(event.target.files?.[0])} /></label><button className="primary-button" onClick={submit}><Check size={15} /> Save signatory</button>{saved.map(item => <div className="saved-signatory" key={item.name}><div className="signature-placeholder">Saved</div><span><strong>{item.name}</strong><small>{item.role}</small></span></div>)}</section>;
}
