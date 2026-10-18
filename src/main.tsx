import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { bridge, isDesktop } from "./bridge";
import { Icon, Brand, Mascot } from "./icons";
import type {
  Provider,
  ProviderId,
  Quota,
  Snapshot,
  Settings,
  Port,
  Result,
} from "./types";
import "./styles.css";
import { CursorTracking } from "./CursorTracking";
import { FocusButton } from "./FocusButton";

const pretty = (v: number) =>
  new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: v > 0 && v < 1 ? 1 : 0,
  }).format(v);
function resetText(at: string | null, now: number) {
  if (!at) return "Yenilenme bilgisi yok";
  const diff = Date.parse(at) - now;
  if (diff <= 0) return "Yenilenme zamanı geldi";
  const mins = Math.ceil(diff / 60000);
  const days = Math.floor(mins / 1440),
    hours = Math.floor((mins % 1440) / 60),
    minutes = mins % 60;
  return `${days ? `${days}g ` : ""}${hours ? `${hours}sa ` : ""}${!days ? `${minutes}dk ` : ""}sonra yenilenir`;
}
function age(at: number | undefined, now: number) {
  if (!at) return "Henüz ölçülmedi";
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  return seconds < 60
    ? "Az önce güncellendi"
    : `${Math.floor(seconds / 60)} dk önce güncellendi`;
}
function activityAge(at: number, now: number) {
  if (!at) return "";
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  return minutes < 1
    ? "Son etkinlik az önce"
    : minutes < 60
      ? `Son etkinlik ${minutes} dk önce`
      : minutes < 1440
        ? `Son etkinlik ${Math.floor(minutes / 60)} sa önce`
        : `Son etkinlik ${Math.floor(minutes / 1440)} gün önce`;
}
const health = (q: number) =>
  q < 20 ? "critical" : q < 50 ? "warning" : "healthy";
const statusText = {
  loading: "Bağlanıyor",
  connected: "Bağlı",
  stale: "Eski ölçüm",
  error: "Bağlantı sorunu",
  "needs-login": "Giriş gerekli",
  unavailable: "Veri bekleniyor",
};

function QuotaRow({
  quota,
  now,
  large = false,
}: {
  quota: Quota;
  now: number;
  large?: boolean;
}) {
  const resetDate = quota.resetsAt
    ? new Date(quota.resetsAt).toLocaleString("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : undefined;
  return (
    <div
      className={`quota-row ${large ? "large" : ""} ${health(quota.remaining)} ${quota.disabled ? "disabled" : ""}`}
    >
      <div className="quota-top">
        <span>{quota.label}</span>
        <span className="quota-number">
          <strong>
            {pretty(quota.remaining)}
            <small>%</small>
          </strong>
          {large && <span>kaldı</span>}
        </span>
      </div>
      <div
        className="meter"
        role="meter"
        aria-label={`${quota.group ? quota.group + " · " : ""}${quota.label} kalan hak`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={quota.remaining}
      >
        <span style={{ width: `${quota.remaining}%` }} />
      </div>
      <div className="reset" title={resetDate}>
        <Icon name="clock" size={12} />
        {resetText(quota.resetsAt, now)}
      </div>
      {quota.disabled && (
        <p className="disabled-note">
          Sağlayıcı bu pencereyi şu an kullanıma kapatmış.
        </p>
      )}
    </div>
  );
}
function ProviderCard({
  provider: p,
  now,
  run,
  onConnect,
}: {
  provider: Provider;
  now: number;
  run: (fn: () => Promise<unknown>) => void;
  onConnect: (id: ProviderId) => void;
}) {
  const groups = Map.groupBy(p.quotas, (q) => q.group || "");
  return (
    <article
      className={`provider-card provider-${p.id} ${p.status === "loading" ? "loading" : ""}`}
      aria-label={`${p.name} kullanımı`}
    >
      <div className="card-heading">
        <div className="provider-identity">
          <span className={`brand brand-${p.id}`}>
            <Brand id={p.id} />
          </span>
          <div>
            <h2>{p.name}</h2>
            <span className="provider-subtitle">
              {p.id === "cursor" && p.plan === "enterprise"
                ? "Teams / Enterprise"
                : p.id === "codex"
                  ? "ChatGPT aboneliği"
                  : p.id === "antigravity"
                    ? "Model kotaları"
                    : p.plan || "Abonelik kullanımı"}
            </span>
          </div>
        </div>
        <button
          className="icon-button usage-link"
          title={`${p.name} kullanım sayfasını aç`}
          aria-label={`${p.name} kullanım sayfasını aç`}
          onClick={() => run(() => bridge.openUsage(p.id))}
        >
          <Icon name="arrow" size={17} />
        </button>
      </div>
      {p.quotas.length > 0 ? (
        <div className="quota-content">
          {Array.from(groups, ([group, quotas], i) => (
            <div className="quota-group" key={group}>
              {group && <h3>{group}</h3>}
              {quotas.map((q, j) => (
                <QuotaRow
                  key={q.id}
                  quota={q}
                  now={now}
                  large={p.id !== "antigravity" && i === 0 && j === 0}
                />
              ))}
            </div>
          ))}
          {p.status === "stale" && (
            <p className="inline-warning">
              {p.message} Son ölçüm gösteriliyor.
            </p>
          )}
        </div>
      ) : p.status === "loading" ? (
        <div
          className="skeleton-block"
          aria-label="Kullanım bilgileri yükleniyor"
        >
          <span />
          <span />
          <span />
        </div>
      ) : (
        <div className="connection-empty">
          <span className="empty-orbit">
            <Brand id={p.id} />
            <i>
              <Icon name="link" size={12} />
            </i>
          </span>
          <h3>
            {p.status === "needs-login"
              ? "Bir kez bağla. Hep gözünün önünde."
              : p.status === "error"
                ? "Bağlantıya bir bakalım."
                : "Kullanım bilgisi bekleniyor."}
          </h3>
          <p>{p.message}</p>
          <button className="connect-button" onClick={() => onConnect(p.id)}>
            <Icon name="link" size={14} />
            {p.id === "antigravity"
              ? "Bağlantı yardımı"
              : `${p.name} hesabını bağla`}
          </button>
        </div>
      )}
      <footer className="card-footer">
        <span className={`connection-state ${p.status}`}>
          <i />
          {statusText[p.status]}
        </span>
        <span title={p.source}>{age(p.updatedAt, now)}</span>
      </footer>
    </article>
  );
}
function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <button
        className="switch"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        onClick={onChange}
      >
        <span />
      </button>
    </div>
  );
}
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [tab, setTab] = useState("quotas");
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState("");
  const [dialog, setDialog] = useState<ProviderId | "settings" | null>(null);
  const [confirmPort, setConfirmPort] = useState<Port | null>(null);
  const [busy, setBusy] = useState(false);
  const modal = useRef<HTMLDialogElement>(null);
  const mascotButton = useRef<HTMLButtonElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const announce = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  }, []);
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        const r = (await fn()) as Result;
        if (r?.ok === false) announce(r.message || "İşlem tamamlanamadı.");
      } catch (error) {
        announce(
          typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : "İşlem tamamlanamadı. Yeniden dene.",
        );
      }
    },
    [announce],
  );
  useEffect(() => {
    void bridge
      .snapshot()
      .then(setSnapshot)
      .catch(() => announce("Uygulamaya bağlanılamadı."));
    return bridge.onUpdate(setSnapshot);
  }, [announce]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (dialog || confirmPort) modal.current?.showModal();
    else modal.current?.close();
  }, [dialog, confirmPort]);
  useEffect(() => {
    if (snapshot?.mode !== "compact") {
      void bridge.hotspot(null).catch(() => {});
      return;
    }
    setDialog(null);
    setConfirmPort(null);
    const element = mascotButton.current;
    if (!element) return;
    const report = () => {
      const { x, y, width, height } = element.getBoundingClientRect();
      if (!element.isConnected || width <= 0 || height <= 0) return;
      void bridge.hotspot({ x, y, width, height }).catch(() => {});
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => observer.disconnect();
  }, [snapshot?.mode]);
  useEffect(() => {
    if (snapshot?.ghostError) announce(snapshot.ghostError);
  }, [snapshot?.ghostError, announce]);
  const updateSettings = (patch: Partial<Settings>) =>
    void run(async () => {
      const r = await bridge.setSettings(patch);
      if (r.providers) setSnapshot(r);
      return r;
    });
  const changeMode = (mode: string) =>
    void run(async () => setSnapshot(await bridge.window(mode)));
  const refresh = async () => {
    if (busy || snapshot?.refreshing) return;
    setBusy(true);
    await run(async () => {
      const s = await bridge.refresh();
      if (s.providers) setSnapshot(s);
    });
    setBusy(false);
  };
  if (!snapshot)
    return (
      <div className="boot">
        <Mascot />
        <p>Kullanım alanın hazırlanıyor…</p>
      </div>
    );
  const s = snapshot;
  const connected = s.providers.filter((p) => p.status === "connected").length;
  const lows = s.providers.flatMap((p) =>
    p.quotas
      .filter((q) => q.remaining < 20)
      .map((q) => ({ provider: p, ...q })),
  );
  const resetNext = s.providers
    .flatMap((p) =>
      p.quotas
        .filter((q) => q.resetsAt && Date.parse(q.resetsAt) > now)
        .map((q) => ({ provider: p, ...q })),
    )
    .sort((a, b) => Date.parse(a.resetsAt!) - Date.parse(b.resetsAt!))[0];
  const mood = s.sessions.some((a) => a.state === "blocked")
    ? "blocked"
    : lows.length
      ? "low"
      : s.sessions.some((a) => a.state === "working")
        ? "working"
        : "idle";
  const closeDialog = () => {
    setDialog(null);
    setConfirmPort(null);
  };
  return (
    <div className={`app mode-${s.mode}`}>
      {s.mode === "compact" ? (
        <div
          className={`compact-bar ${s.settings.clickThrough ? "is-ghost" : ""}`}
        >
          <button
            className="mascot-button"
            ref={mascotButton}
            aria-label="Paneli genişlet"
            title={
              s.settings.clickThrough
                ? "Paneli aç · Alt basılı tutarak geçici bakış"
                : "Paneli aç"
            }
            onClick={() => changeMode("panel")}
          >
            <Mascot mood={mood} small />
            {s.settings.clickThrough && (
              <i className="ghost-light" aria-hidden="true" />
            )}
          </button>
          <span className="compact-divider" />
          {s.providers.map((p) => (
            <button
              key={p.id}
              className={`compact-provider ${p.id}`}
              aria-label={`${p.name} detayları`}
              title={`${p.name} · ${p.quotas.length ? Math.min(...p.quotas.map((q) => q.remaining)).toFixed(0) + "% kaldı" : statusText[p.status]}`}
              onClick={() => {
                changeMode("panel");
                setTab("quotas");
              }}
            >
              <Brand id={p.id} />
              <span>
                {p.quotas.length
                  ? `${pretty(Math.min(...p.quotas.map((q) => q.remaining)))}%`
                  : "···"}
              </span>
            </button>
          ))}
          <button
            className="icon-button compact-expand"
            aria-label="Normal görünüm"
            onClick={() => changeMode("dashboard")}
          >
            <Icon name="expand" size={14} />
          </button>
        </div>
      ) : (
        <>
          <div className="titlebar">
            <div className="window-label">
              <span className="app-mark">
                <span />
                <span />
                <span />
              </span>
              AgentHUD <span className="version">/ 0.7</span>
            </div>
            <div className="window-actions">
              <button
                className={`icon-button ${s.settings.alwaysOnTop ? "active" : ""}`}
                aria-label="Her zaman üstte tut"
                title="Her zaman üstte tut"
                aria-pressed={s.settings.alwaysOnTop}
                onClick={() =>
                  updateSettings({ alwaysOnTop: !s.settings.alwaysOnTop })
                }
              >
                <Icon name="pin" size={14} />
              </button>
              <button
                className="icon-button"
                aria-label="Kompakt görünüm"
                title="Kompakt görünüm"
                onClick={() => changeMode("compact")}
              >
                <Icon name="compact" size={15} />
              </button>
              <button
                className="icon-button"
                aria-label="Ayarları aç"
                title="Ayarlar"
                onClick={() => setDialog("settings")}
              >
                <Icon name="settings" size={14} />
              </button>
              {s.mode === "panel" && (
                <button
                  className="icon-button"
                  aria-label="Normal görünüm"
                  title="Normal görünüm"
                  onClick={() => changeMode("dashboard")}
                >
                  <Icon name="expand" size={14} />
                </button>
              )}
              <span className="window-separator" />
              <button
                className="icon-button"
                aria-label="Simge durumuna küçült"
                onClick={() => void run(() => bridge.window("minimize"))}
              >
                <Icon name="minus" size={14} />
              </button>
              <button
                className="icon-button close-window"
                aria-label="Tepsiye gizle"
                title="Tepsiye gizle"
                onClick={() => void run(() => bridge.window("close"))}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          </div>
          <div className="workspace">
            <aside className="sidebar">
              <div className="workspace-label">KİŞİSEL ALANIN</div>
              <nav aria-label="Ana gezinme">
                {(
                  [
                    {
                      id: "quotas",
                      name: "radar",
                      label: "Kota radarı",
                      count: connected,
                    },
                    {
                      id: "agents",
                      name: "agents",
                      label: "Ajanlar",
                      count: s.sessions.length,
                    },
                    {
                      id: "ports",
                      name: "ports",
                      label: "Yerel portlar",
                      count: s.ports.filter((p) => p.status === "listening")
                        .length,
                    },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    aria-label={t.label}
                    className={`nav-item ${tab === t.id ? "selected" : ""}`}
                    onClick={() => setTab(t.id)}
                    aria-current={tab === t.id ? "page" : undefined}
                  >
                    <Icon name={t.name} />
                    <span>{t.label}</span>
                    <small>{t.count}</small>
                  </button>
                ))}
              </nav>
              <div className="sidebar-tools">
                <span>ARAÇLARIN</span>
                {s.providers.map((p) => (
                  <button
                    key={p.id}
                    className="sidebar-provider"
                    onClick={() => setDialog(p.id)}
                  >
                    <span className={`mini-brand ${p.id}`}>
                      <Brand id={p.id} />
                    </span>
                    {p.name}
                    <i className={`status-dot ${p.status}`} />
                  </button>
                ))}
              </div>
              <div className="sidebar-bottom">
                <div className="companion">
                  <Mascot mood={mood} />
                  <strong>
                    {mood === "low" ? "Bir limitin dolmuş." : "Ben buradayım."}
                  </strong>
                  <p>
                    {mood === "low"
                      ? "Diğer hakların hâlâ elinin altında."
                      : "Sen üret. Limitler gözümün önünde."}
                  </p>
                </div>
                <button
                  className="settings-nav"
                  onClick={() => setDialog("settings")}
                >
                  <Icon name="settings" size={17} />
                  Ayarlar
                </button>
              </div>
            </aside>
            <main>
              <header className="page-header">
                <div className="breadcrumb">
                  Çalışma alanı <span>/</span>{" "}
                  {tab === "quotas"
                    ? "Genel bakış"
                    : tab === "agents"
                      ? "Oturumlar"
                      : "Port yöneticisi"}
                </div>
                <div className="page-title">
                  <div>
                    <h1>
                      {tab === "quotas"
                        ? "Kota radarı"
                        : tab === "agents"
                          ? "Ajanların ne durumda?"
                          : "Yerel portlar"}
                    </h1>
                    <p>
                      {tab === "quotas"
                        ? "Tüm araçların. Kalan hakların. Tek bakışta."
                        : tab === "agents"
                          ? "Açık uygulamalar ve yerel oturumlarından doğrulanan durumlar."
                          : "Çalışan geliştirme sunucuların, bir arada."}
                    </p>
                  </div>
                  <button
                    className="refresh-button"
                    onClick={() => void refresh()}
                    disabled={busy || s.refreshing}
                  >
                    <span className={busy || s.refreshing ? "spinning" : ""}>
                      <Icon name="refresh" size={15} />
                    </span>
                    {busy || s.refreshing ? "Yenileniyor" : "Yenile"}
                  </button>
                </div>
              </header>
              {s.settings.clickThrough && (
                <div className="ghost-note" role="status">
                  <Icon name="info" size={14} />
                  <span>
                    {s.ghostPeeking
                      ? "Alt’ı bırakınca küçük çubuğa dönersin."
                      : "Hayalet modu açık. Küçülttüğünde tıklamalar arkaya geçer."}
                  </span>
                  <button
                    onClick={() => updateSettings({ clickThrough: false })}
                  >
                    Kapat
                  </button>
                </div>
              )}
              {!isDesktop && (
                <div className="preview-notice">
                  <Icon name="info" size={16} />
                  Tarayıcı önizlemesi. Gerçek verileri görmek için masaüstü
                  uygulamasını aç.
                </div>
              )}
              {tab === "quotas" ? (
                <>
                  <div className="overview-strip">
                    <div>
                      <span className="live-dot" />
                      <strong>
                        {connected}
                        <span> / {s.providers.length}</span>
                      </strong>
                      <span>araç bağlı</span>
                    </div>
                    <span className="strip-divider" />
                    <div>
                      <Icon name="clock" size={16} />
                      <span>
                        {resetNext ? (
                          <>
                            <b>{resetNext.provider.name}</b> ·{" "}
                            {resetText(resetNext.resetsAt, now)}
                          </>
                        ) : (
                          "Yenilenme saatleri bağlanınca görünecek"
                        )}
                      </span>
                    </div>
                    <span className="remaining-label">
                      Tüm değerler kalan hakkı gösterir
                    </span>
                  </div>
                  {lows.length > 0 && (
                    <div className="quota-alert">
                      <span>!</span>
                      <p>
                        <strong>
                          {lows[0].provider.name} ·{" "}
                          {lows[0].group || lows[0].label}
                        </strong>
                        {lows[0].remaining === 0
                          ? " limitine ulaşıldı."
                          : " için kullanım hakkın azalıyor."}{" "}
                        <span>
                          {lows[0].resetsAt
                            ? resetText(lows[0].resetsAt, now)
                            : "Diğer limitlerini aşağıdan kontrol edebilirsin."}
                        </span>
                      </p>
                      <button
                        aria-label="Düşük kota detayları"
                        onClick={() => setDialog(lows[0].provider.id)}
                      >
                        <Icon name="arrow" size={16} />
                      </button>
                    </div>
                  )}
                  <div className="provider-grid">
                    {s.providers.map((p) => (
                      <ProviderCard
                        key={p.id}
                        provider={p}
                        now={now}
                        run={(fn) => void run(fn)}
                        onConnect={setDialog}
                      />
                    ))}
                  </div>
                  <div className="privacy-note">
                    <span className="privacy-symbol">
                      <Icon name="check" size={12} />
                    </span>
                    Oturum bilgilerin bu cihazda kalır.
                    <span>Limitler sağlayıcılarından okunur.</span>
                  </div>
                </>
              ) : tab === "agents" ? (
                <section className="list-surface">
                  <CursorTracking
                    connection={s.cursorTracking}
                    disabled={!isDesktop}
                    onChange={(enabled) => bridge.tracking("cursor", enabled)}
                  />
                  {s.sessions.length ? (
                    s.sessions.map((a) => (
                      <div
                        className="session-row"
                        key={a.id}
                        data-provider={a.provider}
                        aria-label={`${a.provider} · ${a.project}`}
                      >
                        <span className={`brand brand-${a.provider}`}>
                          <Brand id={a.provider} />
                        </span>
                        <div className="session-detail">
                          <strong>{a.project}</strong>
                          <span title={a.cwd}>
                            {a.cwd ||
                              "Çalışma durumu için oturum kaydı bulunamadı"}
                          </span>
                          <span
                            className="session-source"
                            title={`${a.source || ""}${a.updatedAt ? ` · ${activityAge(a.updatedAt, now)}` : ""}`}
                          >
                            {a.source}
                            {a.updatedAt
                              ? ` · ${activityAge(a.updatedAt, now)}`
                              : ""}
                          </span>
                        </div>
                        <span className={`agent-state ${a.state}`}>
                          {a.statusLabel ||
                            {
                              working: "Çalışıyor",
                              done: "Tamamlandı",
                              blocked: "Onay bekliyor",
                              idle: "Boşta",
                              unknown: "Durum bilinmiyor",
                            }[a.state]}
                        </span>
                        <FocusButton
                          session={a}
                          onFocus={(id, choice) => bridge.focus(id, choice)}
                          onError={announce}
                        />
                      </div>
                    ))
                  ) : (
                    <Empty
                      icon="agents"
                      title="Henüz oturum görünmüyor"
                      text="Cursor, Codex veya Antigravity açıldığında burada görünecek."
                    />
                  )}
                  <p className="list-explanation">
                    <Icon name="info" size={14} />
                    Bir uygulamanın açık olması, ajanın çalıştığı anlamına
                    gelmez. Durumlar yalnızca doğrulanabilen kayıtlardan alınır.
                  </p>
                  {s.sessionsError && (
                    <p className="inline-warning" role="status">
                      {s.sessionsError}
                    </p>
                  )}
                </section>
              ) : (
                <section className="list-surface">
                  {s.ports.length ? (
                    s.ports.map((p) => (
                      <div className={`port-row ${p.status}`} key={p.key}>
                        <span className={`port-light ${p.status}`} />
                        <strong className="port-number">:{p.port}</strong>
                        <div className="port-detail">
                          <strong>{p.project}</strong>
                          <span>
                            {p.processName} · PID {p.pid}
                            {p.agent ? ` · ${p.agent}` : ""}
                          </span>
                          {p.orphan && p.status === "listening" && (
                            <span className="orphan-note">
                              Üst süreç bulunamadı
                            </span>
                          )}
                        </div>
                        <span className="port-status">
                          {p.status === "listening"
                            ? "Çalışıyor"
                            : "Durduruldu"}
                        </span>
                        {p.status === "listening" ? (
                          <>
                            <button
                              className="icon-button"
                              aria-label={`${p.port} portunu tarayıcıda aç`}
                              title="Tarayıcıda aç"
                              onClick={() =>
                                void run(() => bridge.port("open", p.key))
                              }
                            >
                              <Icon name="arrow" size={16} />
                            </button>
                            <button
                              className="icon-button danger"
                              aria-label={`${p.port} portunu durdur`}
                              title="Durdur"
                              onClick={() => setConfirmPort(p)}
                            >
                              <Icon name="stop" size={15} />
                            </button>
                          </>
                        ) : (
                          <button
                            className="subtle-button"
                            disabled={!p.canRestart}
                            title={
                              p.canRestart
                                ? "Aynı komutla başlat"
                                : "Proje klasörü belirlenemedi"
                            }
                            onClick={() =>
                              void run(() => bridge.port("restart", p.key))
                            }
                          >
                            <Icon name="play" size={14} />
                            Başlat
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <Empty
                      icon="ports"
                      title="Ortalık sakin"
                      text="Açık bir geliştirme portu bulunduğunda burada göreceksin."
                    />
                  )}
                  <p className="list-explanation">
                    <Icon name="info" size={14} />
                    Yalnızca geliştirme süreçleri listelenir. Komutu ve klasörü
                    belirlenen portlar 10 dakika boyunca yeniden başlatılabilir.
                  </p>
                  {s.systemError && (
                    <p className="inline-warning">{s.systemError}</p>
                  )}
                </section>
              )}
              <footer className="page-footer">
                <span>
                  <i />
                  Bu cihazda çalışıyor
                </span>
                {tab === "agents" ? (
                  <span
                    className="session-poll"
                    data-checked-at={s.sessionsUpdatedAt || 0}
                    title={age(s.sessionsUpdatedAt, now)}
                  >
                    Ajanlar 5 saniyede bir kontrol edilir
                  </span>
                ) : (
                  <button onClick={() => setDialog("settings")}>
                    Her {s.settings.refreshSeconds} saniyede bir yenilenir
                    <Icon name="settings" size={12} />
                  </button>
                )}
              </footer>
            </main>
          </div>
        </>
      )}
      <dialog
        ref={modal}
        onCancel={closeDialog}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDialog();
        }}
        aria-labelledby="dialog-title"
      >
        <div className="dialog-header">
          <h2 id="dialog-title">
            {confirmPort
              ? "Portu durdur"
              : dialog === "settings"
                ? "Sana göre ayarla"
                : `${s.providers.find((p) => p.id === dialog)?.name || ""} bağlantısı`}
          </h2>
          <button
            className="icon-button"
            aria-label="Pencereyi kapat"
            onClick={closeDialog}
          >
            <Icon name="close" />
          </button>
        </div>
        {confirmPort ? (
          <>
            <p>
              <b>:{confirmPort.port}</b> portundaki <b>{confirmPort.project}</b>{" "}
              süreci durdurulacak. Bu süreç birden fazla port kullanıyorsa hepsi
              kapanır.
            </p>
            <div className="dialog-actions">
              <button className="subtle-button" onClick={closeDialog}>
                Vazgeç
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  void run(() => bridge.port("stop", confirmPort.key));
                  closeDialog();
                }}
              >
                Süreci durdur
              </button>
            </div>
          </>
        ) : dialog === "settings" ? (
          <>
            <p className="dialog-intro">
              Az yer kaplasın. Tam gerektiği kadar haber versin.
            </p>
            <Switch
              label="Her zaman üstte"
              description="Diğer pencerelerin üzerinde görünür."
              checked={s.settings.alwaysOnTop}
              onChange={() =>
                updateSettings({ alwaysOnTop: !s.settings.alwaysOnTop })
              }
            />
            <Switch
              label="Kota bildirimleri"
              description="Bir limit %20’nin altına düşünce haber verir."
              checked={s.settings.notifications}
              onChange={() =>
                updateSettings({ notifications: !s.settings.notifications })
              }
            />
            <Switch
              label="Kompakt başlat"
              description="Uygulamayı küçük özet çubuğuyla açar."
              checked={s.settings.launchCompact}
              onChange={() =>
                updateSettings({ launchCompact: !s.settings.launchCompact })
              }
            />
            <div className="setting-row">
              <div>
                <strong>Yenileme aralığı</strong>
                <p>Limitlerin ne sıklıkla kontrol edilsin?</p>
              </div>
              <select
                aria-label="Yenileme aralığı"
                value={s.settings.refreshSeconds}
                onChange={(e) =>
                  updateSettings({ refreshSeconds: Number(e.target.value) })
                }
              >
                {[30, 60, 120, 300].map((n) => (
                  <option key={n} value={n}>
                    {n < 60 ? `${n} saniye` : `${n / 60} dakika`}
                  </option>
                ))}
              </select>
            </div>
            <div className="dialog-mode-actions">
              <button
                className="connect-button"
                onClick={() => {
                  changeMode(s.mode === "dashboard" ? "panel" : "dashboard");
                  closeDialog();
                }}
              >
                <Icon name="compact" size={15} />
                {s.mode === "dashboard"
                  ? "Yüzen panele geç"
                  : "Normal görünüme geç"}
              </button>
              {s.mode !== "dashboard" && (
                <button
                  className="subtle-button"
                  disabled={!s.shortcutAvailable || !s.ghostAvailable}
                  title={
                    !s.ghostAvailable
                      ? "Hayalet modu bu bilgisayarda başlatılamadı."
                      : s.shortcutAvailable
                        ? ""
                        : "Geri çağırma kısayolu başka bir uygulamada kullanılıyor."
                  }
                  onClick={() => {
                    updateSettings({ clickThrough: true });
                    closeDialog();
                  }}
                >
                  Hayalet modunu aç
                </button>
              )}
            </div>
            <p className="shortcut-note">
              {s.shortcutAvailable ? (
                <>
                  {s.recoveryShortcut?.split("+").map((key, i) => (
                    <span key={i}>
                      {i > 0 && " + "}
                      <kbd>{key === "CommandOrControl" ? "Ctrl" : key}</kbd>
                    </span>
                  ))}{" "}
                  ile geri çağırabilirsin.
                </>
              ) : (
                "Geri çağırma kısayolu kullanımda. Uygulamayı tepsi simgesinden açabilirsin."
              )}
            </p>
            <p className="shortcut-note">
              Hayalet modunda maskota tıklayarak paneli açabilir, çubuğun
              üzerindeyken <kbd>Alt</kbd> basılı tutarak geçici bakabilirsin.
            </p>
            <button
              className="quit-button"
              onClick={() => void run(() => bridge.window("quit"))}
            >
              Uygulamadan çık
            </button>
          </>
        ) : (
          dialog && (
            <Connection
              provider={s.providers.find((p) => p.id === dialog)!}
              run={(fn) => void run(fn)}
              onClose={closeDialog}
            />
          )
        )}
      </dialog>
      {toast && (
        <div className="toast" role="status">
          <Icon name="info" size={17} />
          {toast}
          <button aria-label="Bildirimi kapat" onClick={() => setToast("")}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: "agents" | "ports";
  title: string;
  text: string;
}) {
  return (
    <div className="list-empty">
      <Icon name={icon} size={32} />
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
function Connection({
  provider: p,
  run,
  onClose,
}: {
  provider: Provider;
  run: (fn: () => Promise<unknown>) => void;
  onClose: () => void;
}) {
  return (
    <div className="connection-dialog">
      <div className={`connection-brand brand-${p.id}`}>
        <Brand id={p.id} />
      </div>
      <p>
        {p.id === "antigravity"
          ? "Antigravity uygulamasını aç ve hesabına giriş yap. AgentHUD, uygulamanın yerel kullanım servisinden model gruplarını okur."
          : p.id === "codex"
            ? "Codex uygulamasında veya CLI’da ChatGPT hesabınla giriş yap. AgentHUD mevcut yerel oturumdan plan limitlerini okur."
            : "Cursor uygulamasında hesabına giriş yap. AgentHUD mevcut yerel oturumdan Cursor Models ve Other Models limitlerini ayrı okur."}
      </p>
      <div className="source-detail">
        <Icon name="info" size={16} />
        <span>
          {p.source
            ? `Veri kaynağı: ${p.source}`
            : "Kullanım için ilgili uygulamada açık bir oturum gerekli."}
        </span>
      </div>
      {p.message && <p className="inline-warning">{p.message}</p>}
      <button
        className="primary-button"
        onClick={() =>
          run(async () => {
            await bridge.refresh();
            onClose();
          })
        }
      >
        Bağlantıyı yeniden kontrol et
        <Icon name="refresh" size={16} />
      </button>
      <button
        className="text-button"
        onClick={() => run(() => bridge.openUsage(p.id))}
      >
        Sağlayıcının kullanım sayfasını aç
        <Icon name="arrow" size={13} />
      </button>
      <p className="connection-footnote">
        Parolanı AgentHUD’a girmezsin. Gizli bilgiler arayüzle paylaşılmaz.
      </p>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
