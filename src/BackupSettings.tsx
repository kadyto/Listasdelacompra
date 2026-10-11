import { useEffect, useState } from "react";
import { Download, HardDriveDownload, RotateCcw } from "lucide-react";
import { Confirm, ErrorBox } from "./components";
import { api, dateTime, number } from "./lib";

interface BackupFile {
  filename: string;
  size: number;
  created_at: string;
  automatic: boolean;
}

export function BackupSettings({
  revision,
  onRestored,
}: {
  revision: number;
  onRestored: () => void;
}) {
  const [files, setFiles] = useState<BackupFile[] | null>(null);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<BackupFile | null>(null);
  useEffect(() => {
    let live = true;
    api<BackupFile[]>("/backups")
      .then((data) => {
        if (live) {
          setFiles(data);
          setError("");
        }
      })
      .catch((failure: Error) => {
        if (live) setError(failure.message);
      });
    return () => {
      live = false;
    };
  }, [revision, generation]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await api<BackupFile>("/backups", "POST");
      setMessage("Copia creada y verificada en la carpeta de backups.");
      setGeneration((value) => value + 1);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await api("/backups/restore", "POST", {
        filename: selected.filename,
        confirm: true,
      });
      setSelected(null);
      setMessage(
        "Datos restaurados. Se ha guardado también una copia automática del estado anterior.",
      );
      setGeneration((value) => value + 1);
      onRestored();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="panel maintenance backup-panel"
      aria-labelledby="backups-title"
    >
      <div className="section-heading compact">
        <h2 id="backups-title">
          <HardDriveDownload size={19} /> Copias de seguridad
        </h2>
      </div>
      <p>
        Crea una copia de todas tus listas, productos y precios en la carpeta de
        backups del servidor.
      </p>
      <button
        className="button primary backup-create"
        disabled={busy}
        onClick={create}
      >
        <HardDriveDownload size={18} /> {busy ? "Procesando…" : "Crear copia"}
      </button>
      {message && (
        <p className="backup-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <ErrorBox
          message={error}
          retry={() => setGeneration((value) => value + 1)}
        />
      )}
      {files === null && !error && <p role="status">Cargando copias…</p>}
      {files?.length === 0 && <p>Todavía no hay copias guardadas.</p>}
      <div className="backup-list">
        {files?.map((file) => (
          <div className="backup-row" key={file.filename}>
            <div className="backup-info">
              <strong>
                {file.automatic
                  ? "Copia antes de restaurar"
                  : "Copia de seguridad"}
              </strong>
              <small>
                {dateTime(file.created_at)} · {number(file.size / 1024)} KB
              </small>
              <span>{file.filename}</span>
            </div>
            <div className="backup-actions">
              <a
                className="text-button"
                href={`/api/backups/${encodeURIComponent(file.filename)}/download`}
                aria-label={`Descargar copia ${file.filename}`}
                download={file.filename}
              >
                <Download size={16} /> Descargar
              </a>
              <button
                className="text-button"
                disabled={busy}
                aria-label={`Restaurar copia ${file.filename}`}
                onClick={() => setSelected(file)}
              >
                <RotateCcw size={16} /> Restaurar
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="field-hint">
        Puedes descargar una copia para conservarla en otro dispositivo. Al
        restaurar se sustituyen los datos de todo el espacio familiar y se
        guarda una copia previa automáticamente.
      </p>
      {selected && (
        <Confirm
          title="¿Restaurar esta copia?"
          text={`Se recuperarán las listas, productos y precios de la copia del ${dateTime(selected.created_at)} (${selected.filename}). Los datos actuales de todos los dispositivos se sustituirán. Antes se guardará una copia automática del estado actual.`}
          onClose={() => {
            if (!busy) setSelected(null);
          }}
          onConfirm={restore}
        />
      )}
    </section>
  );
}
