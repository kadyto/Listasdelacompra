import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  CircleHelp,
  Github,
  RefreshCw,
  ArrowUpCircle,
} from "lucide-react";
import { api } from "./lib";

type Version = {
  version: string;
  source: string | null;
};
type Update = Version & {
  status: "current" | "available" | "unknown";
  checkedAt: string;
  nextCheckAt: string;
};
const projectUrl = "https://github.com/kadyto/Listasdelacompra";

export default function ProjectVersion() {
  const [version, setVersion] = useState<Version | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [checking, setChecking] = useState(false);
  const nextCheck = useRef(0);
  const running = useRef(false);

  async function check() {
    if (running.current) return;
    running.current = true;
    setChecking(true);
    try {
      const result = await api<Update>("/version/check");
      setVersion(result);
      setUpdate(result);
      nextCheck.current = Date.parse(result.nextCheckAt);
    } catch {
      setUpdate(null);
      nextCheck.current = Date.now() + 5 * 60_000;
    } finally {
      running.current = false;
      setChecking(false);
    }
  }
  useEffect(() => {
    let active = true;
    api<Version>("/version")
      .then((result) => {
        if (active) setVersion(result);
      })
      .catch(() => {});
    void check();
    const refresh = () => {
      if (
        document.visibilityState === "visible" &&
        navigator.onLine &&
        Date.now() >= nextCheck.current
      )
        void check();
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const status = checking ? "checking" : (update?.status ?? "unknown");
  const checked = update?.checkedAt
    ? `Última comprobación: ${new Date(update.checkedAt).toLocaleString("es-ES")}.`
    : "";
  return (
    <div className="project-version" aria-label="Proyecto y versión instalada">
      <a
        href={projectUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="project-link"
      >
        <Github size={15} aria-hidden="true" /> Proyecto en GitHub
      </a>
      <span
        className="installed-version"
        title="Versión instalada e identificador de la compilación"
      >
        {version
          ? `v${version.version}${version.source ? ` · ${version.source.slice(0, 8)}` : ""}`
          : "Versión no disponible"}
      </span>
      <span className={`version-status ${status}`} role="status">
        {status === "available" ? (
          <a
            href={`${projectUrl}/commits/main/`}
            target="_blank"
            rel="noopener noreferrer"
            title={`${checked} Reconstruye la imagen y despliega el stack para actualizar.`}
          >
            <ArrowUpCircle size={15} aria-hidden="true" /> Actualización
            disponible
          </a>
        ) : status === "current" ? (
          <>
            <CheckCircle2 size={15} aria-hidden="true" /> Al día
          </>
        ) : status === "checking" ? (
          <>Comprobando…</>
        ) : (
          <>
            <CircleHelp size={15} aria-hidden="true" /> No se pudo comprobar
          </>
        )}
      </span>
      <button
        type="button"
        className="version-refresh"
        onClick={() => void check()}
        disabled={checking}
        aria-label="Comprobar actualizaciones"
        title={`${checked} Comprobar actualizaciones. GitHub se consulta como máximo una vez por hora; si falla, se reintenta tras cinco minutos.`}
      >
        <RefreshCw
          size={15}
          aria-hidden="true"
          className={checking ? "checking" : ""}
        />
      </button>
    </div>
  );
}
