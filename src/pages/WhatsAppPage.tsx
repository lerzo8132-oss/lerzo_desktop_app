import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ExternalLink, MessageCircle, QrCode, Save } from 'lucide-react';
import { api, configureApiClient } from '../services/api';
import { extractApiErrorMessage } from '../services/apiErrors';
import {
  beginPageLoading,
  endPageLoading,
  refreshScopes,
  registerPageRefresh,
  showAppToast,
} from '../services/appShell';
import '../styles/whatsapp.css';

type WhatsAppPageKey = 'dashboard' | 'contacts' | 'templates' | 'campaigns' | 'logs' | 'analytics' | 'settings';

type WhatsAppPayload = {
  configured?: boolean;
  summary?: Record<string, number>;
  settings?: Record<string, string | boolean>;
  contacts?: Array<Record<string, unknown>>;
  templates?: Array<Record<string, unknown>>;
  campaigns?: Array<Record<string, unknown>>;
  logs?: Array<Record<string, unknown>>;
};

const tabs: Array<[WhatsAppPageKey, string, string]> = [
  ['dashboard', 'Dashboard', '/whatsapp-dashboard'],
  ['contacts', 'Contacts', '/whatsapp-contacts'],
  ['templates', 'Templates', '/whatsapp-templates'],
  ['campaigns', 'Campaigns', '/whatsapp-campaigns'],
  ['logs', 'Message Logs', '/whatsapp-logs'],
  ['analytics', 'Analytics', '/whatsapp-analytics'],
  ['settings', 'Settings', '/whatsapp-settings'],
];

function text(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function fieldValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '';
  return String(value);
}

function EmptyState() {
  return (
    <div className="card whatsapp-empty-card">
      <MessageCircle className="w-10 h-10" />
      <p className="label-meta">No records found.</p>
    </div>
  );
}

function DataTable({ rows, columns }: { rows: Array<Record<string, unknown>>; columns: string[] }) {
  if (!rows.length) return <EmptyState />;
  return (
    <div className="card whatsapp-table-card">
      <table className="table">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column.replace(/_/g, ' ')}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id ?? index)}>
              {columns.map((column) => <td key={column}>{text(row[column])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function WhatsAppPage({ page }: { page: WhatsAppPageKey }) {
  const [payload, setPayload] = useState<WhatsAppPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const settings = payload?.settings || {};

  const loadPageData = useCallback(async () => {
    beginPageLoading();
    setLoading(true);
    try {
      await configureApiClient();
      const response = await api.get(`/whatsapp/${page}`);
      setPayload(response.data || {});
    } catch (error) {
      showAppToast(extractApiErrorMessage(error, 'Unable to load WhatsApp data.'), 'error');
    } finally {
      setLoading(false);
      endPageLoading();
    }
  }, [page]);

  useEffect(() => {
    void loadPageData();
  }, [loadPageData]);

  useEffect(() => registerPageRefresh('whatsapp', loadPageData), [loadPageData]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      const response = await api.post('/whatsapp/settings', body);
      setPayload((current) => ({ ...(current || {}), settings: response.data.settings, configured: response.data.settings?.is_configured }));
      showAppToast('WhatsApp settings saved successfully.');
      await refreshScopes(['whatsapp']);
      await loadPageData();
    } catch (error) {
      showAppToast(extractApiErrorMessage(error, 'Unable to save WhatsApp settings.'), 'error');
    }
  }

  return (
    <div className="template-page p-32 whatsapp-module">
      <div className="whatsapp-page-header">
        <div>
          <h1 className="page-title">WhatsApp</h1>
          <p className="label-meta">Send pending-fee messages through WhatsApp Web.</p>
        </div>
      </div>

      <nav className="whatsapp-tabs" aria-label="WhatsApp sections">
        {tabs.map(([key, label, to]) => (
          <NavLink
            key={key}
            to={to}
            className={({ isActive }) => `whatsapp-tab${isActive ? ' active' : ''}`}
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="whatsapp-body">
        {(page === 'dashboard' || page === 'settings') ? (
          <div className="card whatsapp-info-card">
            <QrCode className="w-5 h-5" style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <div className="whatsapp-info-text">
              <h3 className="card-title">WhatsApp Web</h3>
              <p className="label-meta">Open WhatsApp Web and send one message at a time.</p>
            </div>
            <a
              className="btn btn-primary whatsapp-info-action"
              href="https://web.whatsapp.com/"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="w-4 h-4" />
              Open WhatsApp Web
            </a>
          </div>
        ) : null}

        {loading ? <div className="card skeleton whatsapp-loading-card" /> : null}

        {!loading && page === 'dashboard' ? (
          <DataTable rows={payload?.logs?.slice(0, 10) || []} columns={['recipient_name', 'phone', 'status', 'created_at']} />
        ) : null}
        {!loading && page === 'contacts' ? <DataTable rows={payload?.contacts || []} columns={['name', 'phone', 'email', 'tags']} /> : null}
        {!loading && page === 'templates' ? <DataTable rows={payload?.templates || []} columns={['name', 'language', 'category', 'status']} /> : null}
        {!loading && page === 'campaigns' ? <DataTable rows={payload?.campaigns || []} columns={['name', 'status', 'created_at']} /> : null}
        {!loading && page === 'logs' ? <DataTable rows={payload?.logs || []} columns={['recipient_name', 'phone', 'message', 'status']} /> : null}
        {!loading && page === 'analytics' ? (
          <DataTable rows={payload?.logs || []} columns={['recipient_name', 'phone', 'status', 'created_at']} />
        ) : null}
        {!loading && page === 'settings' ? (
          <div className="card whatsapp-settings-card">
            <form onSubmit={saveSettings} className="grid-form">
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="label">Pending Fee Message Template</label>
                <textarea
                  className="input"
                  name="template_settings"
                  rows={6}
                  defaultValue={fieldValue(settings.template_settings) || 'Dear {name}, your pending fee balance is Rs. {balance}. Please contact {centre} for payment assistance.'}
                />
                <p className="label-meta" style={{ marginTop: 8 }}>Placeholders: {'{name}'}, {'{balance}'}, {'{centre}'}, {'{enrollment}'}</p>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <button type="submit" className="btn btn-primary">
                  <Save className="w-4 h-4" />
                  Save Settings
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
