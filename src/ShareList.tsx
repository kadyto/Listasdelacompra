import { useRef, useState } from "react";
import { Copy, Share2 } from "lucide-react";
import { Modal } from "./components";
import { number, pack } from "./lib";
import type { Item } from "./types";

export function ShareList({ store, items }: { store: string; items: Item[] }) {
  const [text, setText] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [message, setMessage] = useState("");
  const preview = useRef<HTMLTextAreaElement>(null);

  const share = async () => {
    if (sharing || !items.length) return;
    const title = `Lista de la compra · ${store}`;
    const content = [
      title,
      "",
      "Por comprar:",
      ...items.map(
        (item) =>
          `• ${number(item.quantity)} × ${item.name} (${pack(item)})${item.notes ? `\n  Nota: ${item.notes}` : ""}`,
      ),
    ].join("\n");
    setMessage("");
    if (navigator.share) {
      setSharing(true);
      try {
        await navigator.share({ title, text: content });
        return;
      } catch (error) {
        if ((error as { name?: string } | null)?.name === "AbortError") return;
      } finally {
        setSharing(false);
      }
    }
    setText(content);
  };

  const copy = async () => {
    if (copying || text === null) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Lista copiada. Ya puedes pegarla en tu conversación.");
    } catch {
      preview.current?.focus();
      preview.current?.select();
      setMessage(
        "Texto seleccionado. Usa «Copiar» en el menú del móvil o del navegador.",
      );
    } finally {
      setCopying(false);
    }
  };

  return (
    <>
      <button
        className="button secondary"
        disabled={sharing || !items.length}
        title={
          items.length
            ? "Compartir los artículos pendientes"
            : "No hay artículos pendientes"
        }
        onClick={share}
      >
        <Share2 size={18} /> Compartir
      </button>
      {text !== null && (
        <Modal
          title="Compartir lista"
          subtitle="Envía los artículos pendientes con sus cantidades y notas."
          onClose={() => setText(null)}
        >
          <label>
            Texto de la lista
            <textarea ref={preview} value={text} readOnly rows={9} />
          </label>
          {message && (
            <p className="field-hint" role="status">
              {message}
            </p>
          )}
          <div className="form-actions share-actions">
            <button
              className="button secondary"
              disabled={copying}
              onClick={copy}
            >
              <Copy size={17} /> Copiar texto
            </button>
            <a
              className="button primary"
              href={`https://wa.me/?text=${encodeURIComponent(text)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Compartir por WhatsApp
            </a>
          </div>
        </Modal>
      )}
    </>
  );
}
