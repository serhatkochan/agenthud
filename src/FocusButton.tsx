import { useEffect, useRef, useState, useId } from "react";
import { Icon } from "./icons";
import type { AgentSession, FocusChoice, FocusResult } from "./types";

export function FocusButton({
  session,
  onFocus,
  onError,
}: {
  session: AgentSession;
  onFocus: (id: string, choice?: string) => Promise<FocusResult>;
  onError: (message: string) => void;
}) {
  const [choices, setChoices] = useState<FocusChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const modal = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (choices.length) modal.current?.showModal();
    else modal.current?.close();
  }, [choices]);
  const close = () => {
    setChoices([]);
    setMessage("");
  };
  const request = async (choice?: string) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await onFocus(session.id, choice);
      if (result.ok === false) {
        const text = result.message || "Pencere açılamadı.";
        if (choices.length) setMessage(text);
        else onError(text);
      } else if (result.choices?.length) setChoices(result.choices);
      else close();
    } catch {
      if (choices.length) setMessage("Pencere açılamadı. Listeyi yenile.");
      else onError("Pencere açılamadı. Yeniden dene.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className="subtle-button focus-button"
        disabled={busy}
        aria-label={`${session.project} penceresine odaklan`}
        title="İlgili uygulama penceresini öne getir"
        onClick={() => void request()}
      >
        Odaklan
        <Icon name="arrow" size={13} />
      </button>
      <dialog
        ref={modal}
        aria-labelledby={titleId}
        onCancel={close}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="dialog-header">
          <h2 id={titleId}>Hangi pencereyi açalım?</h2>
          <button
            className="icon-button"
            aria-label="Pencere seçimini kapat"
            onClick={close}
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="dialog-intro">
          <strong>{session.project}</strong> için birden fazla pencere var.
          Açmak istediğini seç.
        </p>
        <div className="focus-choices">
          {choices.map((choice) => (
            <button
              key={choice.id}
              className="focus-choice"
              disabled={busy}
              onClick={() => void request(choice.id)}
              aria-label={`${choice.title} penceresini aç`}
            >
              <span>
                <strong>{choice.title}</strong>
                <small>{choice.app}</small>
              </span>
              <Icon name="arrow" size={15} />
            </button>
          ))}
        </div>
        {message && (
          <p role="alert" className="inline-warning">
            {message}
          </p>
        )}
        <div className="dialog-actions">
          <button
            className="subtle-button"
            disabled={busy}
            onClick={() => void request()}
          >
            Listeyi yenile
          </button>
          <button className="subtle-button" onClick={close}>
            Vazgeç
          </button>
        </div>
      </dialog>
    </>
  );
}
