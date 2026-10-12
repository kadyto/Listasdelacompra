import { useEffect, useState } from "react";
import { Download, LoaderCircle, CheckCircle2 } from "lucide-react";
import { ErrorBox, Modal } from "./components";
import { api } from "./lib";

type Job = {
  id: string;
  phase: string;
  message: string;
  target_version?: string;
  backup_filename?: string;
};
type Status = { enabled: boolean; job: Job | null };
const terminal = new Set(["completed", "failed"]);

export default function UpdateDialog({
  onClose,
  onStarted,
}: {
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [startedId, setStartedId] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const job = status?.job;
  const busy = Boolean(job && !terminal.has(job.phase));

  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const next = await api<Status>("/updates");
        if (!live) return;
        setStatus(next);
        setError("");
        setWaiting(false);
      } catch (failure) {
        if (!live) return;
        if (startedId) setWaiting(true);
        else setError((failure as Error).message);
      }
    };
    void poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [startedId]);

  const start = async () => {
    if (starting || busy) return;
    setStarting(true);
    setError("");
    try {
      const next = await api<Job>("/updates", "POST", { confirm: true });
      setStartedId(next.id);
      onStarted(next.id);
      setStatus({ enabled: true, job: next });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Modal
      title="Actualizar la aplicación"
      subtitle="Nueva versión desde GitHub"
      onClose={() => {
        if (!starting) onClose();
      }}
    >
      <div className="update-dialog">
        <p>
          Se descargará y preparará la nueva versión, se guardará una copia de
          seguridad y se reiniciará la aplicación. Tus listas y precios se
          conservarán.
        </p>
        <p>
          Puedes seguir utilizando la aplicación durante la preparación. Al
          terminar se recargará la página; guarda los cambios de los formularios
          antes de continuar.
        </p>
        {error && <ErrorBox message={error} />}
        {!status && !error && (
          <p role="status">Comprobando el estado de la actualización…</p>
        )}
        {status && !status.enabled && (
          <p>
            Instala primero la imagen actualizada desde Dockhand para habilitar
            las actualizaciones desde aquí.
          </p>
        )}
        {job && (
          <div className={`update-progress ${job.phase}`} role="status">
            {busy ? (
              <LoaderCircle size={22} className="spin" />
            ) : job.phase === "completed" ? (
              <CheckCircle2 size={22} />
            ) : null}
            <div>
              {job.target_version && (
                <strong>Versión {job.target_version}</strong>
              )}
              <p>
                {waiting
                  ? "La aplicación se está reiniciando. Esperando a que vuelva a estar disponible…"
                  : job.message}
              </p>
              {job.backup_filename && (
                <small>Copia previa: {job.backup_filename}</small>
              )}
            </div>
          </div>
        )}
        {busy && (
          <p className="field-hint">
            La preparación puede tardar varios minutos. Puedes cerrar esta
            ventana; la actualización continuará.
          </p>
        )}
        <div className="modal-actions">
          <button
            className="button secondary"
            onClick={onClose}
            disabled={starting}
          >
            {busy ? "Cerrar" : "Cancelar"}
          </button>
          {status?.enabled && !busy && (
            <button
              className="button primary"
              disabled={starting}
              onClick={() => void start()}
            >
              <Download size={18} />{" "}
              {starting
                ? "Iniciando…"
                : job?.phase === "failed"
                  ? "Reintentar actualización"
                  : "Actualizar aplicación"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
