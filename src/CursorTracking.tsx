import { useEffect, useRef, useState } from "react";
import { Brand, Icon } from "./icons";
import type { TrackingConnection, Result } from "./types";

export function CursorTracking({
  connection,
  onChange,
  disabled = false,
}: {
  connection: TrackingConnection;
  onChange: (enabled: boolean) => Promise<Result>;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [target, setTarget] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (visible) modal.current?.showModal();
    else modal.current?.close();
  }, [visible]);
  const open = () => {
    setTarget(!connection.enabled);
    setMessage("");
    setVisible(true);
  };
  const submit = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await onChange(target);
      if (result.ok === false)
        setMessage(result.message || "Takip ayarı kaydedilemedi.");
      else setVisible(false);
    } catch {
      setMessage("Takip ayarı kaydedilemedi. Yeniden dene.");
    } finally {
      setBusy(false);
    }
  };
  const label = {
    loading: "Kontrol ediliyor",
    off: "Kapalı",
    waiting: "İlk olay bekleniyor",
    active: "Bağlı",
    error: "Kontrol gerekli",
  }[connection.status];
  return (
    <>
      <div
        className="tracking-connection"
        data-tracking-status={connection.status}
      >
        <span className="brand brand-cursor">
          <Brand id="cursor" />
        </span>
        <div className="tracking-description">
          <strong>Cursor durum takibi</strong>
          <p>
            {connection.message ||
              (connection.status === "waiting"
                ? "Cursor’da bir ajan çalıştığında olaylar burada görünür."
                : "Çalışma ve bitiş olaylarını projeleriyle gör.")}
          </p>
          <span className={`tracking-status ${connection.status}`}>
            {label}
          </span>
        </div>
        <button
          className="subtle-button"
          disabled={disabled || connection.status === "loading"}
          aria-label={
            connection.enabled
              ? "Cursor durum takibini kapat"
              : "Cursor durum takibini bağla"
          }
          onClick={open}
        >
          {connection.enabled ? "Takibi kapat" : "Bağla"}
          <Icon name="arrow" size={13} />
        </button>
      </div>
      <dialog
        ref={modal}
        aria-labelledby="cursor-tracking-title"
        onCancel={() => setVisible(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setVisible(false);
        }}
      >
        <div className="dialog-header">
          <h2 id="cursor-tracking-title">Cursor durum takibi</h2>
          <button
            className="icon-button"
            aria-label="Takip penceresini kapat"
            onClick={() => setVisible(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="dialog-intro">
          {target
            ? "Bu kullanıcı hesabındaki Cursor oturumlarını izle. Mevcut Cursor ayarların yedeklenir; diğer bağlantıların korunur."
            : "AgentHUD’un Cursor gözlemcisi kaldırılacak. Diğer Cursor ayarların korunur."}
        </p>
        {target && (
          <div className="tracking-facts">
            <p>
              Kaydedilenler: olay türü, proje klasörü, oturum kimliği ve zaman.
            </p>
            <p>
              Sohbet içeriği kaydedilmez. Komut onaylarına müdahale edilmez.
            </p>
          </div>
        )}
        <details className="tracking-file">
          <summary>Değişecek ayar dosyası</summary>
          <code>{connection.configPath}</code>
        </details>
        {message && (
          <p className="inline-warning" role="alert">
            {message}
          </p>
        )}
        <div className="dialog-actions">
          <button
            className="subtle-button"
            disabled={busy}
            onClick={() => setVisible(false)}
          >
            Vazgeç
          </button>
          <button
            className="connect-button"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy
              ? "Kaydediliyor…"
              : target
                ? "Takibi etkinleştir"
                : "Takibi kapat"}
          </button>
        </div>
      </dialog>
    </>
  );
}
