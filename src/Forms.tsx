import { useEffect, useState, type FormEvent } from "react";
import { Plus, Search, Check, Tag } from "lucide-react";
import { api, localDateTime, madridToISO, pack } from "./lib";
import type { Category, Item, Price, Product, Store } from "./types";
import { Brand, ErrorBox, Modal } from "./components";

type Common = { onClose: () => void; onSaved: (message: string) => void };
function useSubmit(onSaved: Common["onSaved"]) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async (
    event: FormEvent,
    work: () => Promise<unknown>,
    message: string,
  ) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      onSaved(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}
function Actions({
  busy,
  onClose,
  label = "Guardar",
}: {
  busy: boolean;
  onClose: () => void;
  label?: string;
}) {
  return (
    <div className="form-actions">
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={onClose}
      >
        Cancelar
      </button>
      <button className="button primary" type="submit" disabled={busy}>
        {busy ? "Guardando…" : label}
      </button>
    </div>
  );
}
export function ProductForm({
  product,
  stores,
  categories,
  defaultList,
  onClose,
  onSaved,
}: Common & {
  product?: Product;
  stores: Store[];
  categories: Category[];
  defaultList?: number;
}) {
  const [name, setName] = useState(product?.name ?? ""),
    [brand, setBrand] = useState(product?.brand ?? "");
  const [category, setCategory] = useState(
    product?.category_id ??
      categories.find((c) => c.name === "Otros")?.id ??
      categories[0]?.id ??
      0,
  );
  const [amount, setAmount] = useState(product?.package_amount ?? 1),
    [unit, setUnit] = useState(product?.unit ?? "ud");
  const [ean, setEan] = useState(product?.ean ?? ""),
    [notes, setNotes] = useState(product?.notes ?? "");
  const present = new Set(product?.lists?.map((l) => l.list_id) ?? []);
  const [listIds, setListIds] = useState<number[]>(
    defaultList ? [defaultList] : [],
  );
  const { busy, error, submit } = useSubmit(onSaved);
  return (
    <Modal
      title={product ? "Editar producto" : "Nuevo producto"}
      subtitle="Un producto, todas tus listas."
      onClose={onClose}
    >
      <form
        onSubmit={(e) =>
          submit(
            e,
            () =>
              api(
                product ? `/products/${product.id}` : "/products",
                product ? "PUT" : "POST",
                {
                  name,
                  brand,
                  category_id: category,
                  package_amount: amount,
                  unit,
                  ean,
                  notes,
                  list_ids: listIds,
                },
              ),
            product
              ? "Producto actualizado"
              : "Producto creado y añadido a tus listas",
          )
        }
      >
        {error && <ErrorBox message={error} />}
        <label>
          Nombre del producto
          <input
            autoFocus
            required
            maxLength={160}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Pepsi Zero"
          />
        </label>
        <div className="form-grid">
          <label>
            Marca <span className="optional">opcional</span>
            <input
              maxLength={100}
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="Ej. Pepsi"
            />
          </label>
          <label>
            Categoría
            <select
              required
              value={category}
              onChange={(e) => setCategory(Number(e.target.value))}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label>
            Cantidad del envase
            <input
              required
              type="number"
              min="0.001"
              max="100000"
              step="any"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </label>
          <label>
            Unidad
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="ud">Unidades</option>
              <option value="l">Litros</option>
              <option value="ml">Mililitros</option>
              <option value="kg">Kilogramos</option>
              <option value="g">Gramos</option>
            </select>
          </label>
        </div>
        <p className="field-hint">
          Cada presentación tiene sus propios precios. Un envase de 2 l y uno de
          330 ml son productos distintos.
        </p>
        <label>
          Código EAN <span className="optional">opcional</span>
          <input
            inputMode="numeric"
            maxLength={14}
            pattern="([0-9]{8}|[0-9]{12,14})?"
            value={ean}
            onChange={(e) => setEan(e.target.value)}
            placeholder="Código de barras"
          />
        </label>
        <label>
          Notas <span className="optional">opcional</span>
          <textarea
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Lo que quieras recordar…"
            rows={2}
          />
        </label>
        <fieldset>
          <legend>
            {product
              ? "Añadir a otras listas"
              : "Añadir también a estas listas"}
          </legend>
          <div className="store-options">
            {stores
              .filter((s) => s.active)
              .map((s) => (
                <label className="checkbox-card" key={s.id}>
                  <input
                    type="checkbox"
                    checked={
                      present.has(s.list_id) || listIds.includes(s.list_id)
                    }
                    disabled={present.has(s.list_id)}
                    onChange={(e) =>
                      setListIds((ids) =>
                        e.target.checked
                          ? [...ids, s.list_id]
                          : ids.filter((id) => id !== s.list_id),
                      )
                    }
                  />
                  <Brand name={s.name} small />
                  <span>
                    {s.name}
                    {present.has(s.list_id) && (
                      <small>Ya está en la lista</small>
                    )}
                  </span>
                </label>
              ))}
          </div>
        </fieldset>
        <Actions
          busy={busy}
          onClose={onClose}
          label={product ? "Guardar cambios" : "Crear producto"}
        />
      </form>
    </Modal>
  );
}
export function PriceForm({
  products,
  stores,
  productId,
  storeId,
  record,
  onClose,
  onSaved,
}: Common & {
  products: Product[];
  stores: Store[];
  productId?: number;
  storeId?: number;
  record?: Price;
}) {
  const [selectedProduct, setProduct] = useState(
    record?.product_id ?? productId ?? products[0]?.id ?? 0,
  );
  const [selectedStore, setStore] = useState(
    record?.store_id ?? storeId ?? stores.find((s) => s.active)?.id ?? 0,
  );
  const [price, setPrice] = useState(
    record ? (record.cents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [recordedAt, setDate] = useState(localDateTime(record?.recorded_at)),
    [notes, setNotes] = useState(record?.notes ?? ""),
    [sale, setSale] = useState(Boolean(record?.on_sale));
  const { busy, error, submit } = useSubmit(onSaved);
  return (
    <Modal
      title={record ? "Corregir precio" : "Registrar precio"}
      subtitle={
        record
          ? "Corrige este registro; los demás se conservarán."
          : "Guarda lo que has visto. Podrás compararlo después."
      }
      onClose={onClose}
    >
      <form
        onSubmit={(e) =>
          submit(
            e,
            () =>
              api(
                record ? `/prices/${record.id}` : "/prices",
                record ? "PUT" : "POST",
                {
                  product_id: selectedProduct,
                  store_id: selectedStore,
                  price,
                  recorded_at: madridToISO(recordedAt),
                  notes,
                  on_sale: sale,
                },
              ),
            record
              ? "Precio corregido"
              : "Precio registrado; el historial se ha conservado",
          )
        }
      >
        {error && <ErrorBox message={error} />}
        <label>
          Producto
          <select
            required
            value={selectedProduct}
            disabled={Boolean(record || productId)}
            onChange={(e) => setProduct(Number(e.target.value))}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {pack(p)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Supermercado
          <select
            required
            value={selectedStore}
            onChange={(e) => setStore(Number(e.target.value))}
          >
            {stores
              .filter((s) => s.active || s.id === record?.store_id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {!s.active ? " (inactivo)" : ""}
                </option>
              ))}
          </select>
        </label>
        <label>
          Precio del envase
          <div className="price-input">
            <input
              autoFocus
              required
              inputMode="decimal"
              pattern="[0-9]{1,6}([,.][0-9]{1,2})?"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0,00"
              aria-label="Precio en euros"
            />
            <span>€</span>
          </div>
        </label>
        <label>
          Fecha y hora (Madrid)
          <input
            required
            type="datetime-local"
            value={recordedAt}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="check-line">
          <input
            type="checkbox"
            checked={sale}
            onChange={(e) => setSale(e.target.checked)}
          />
          <Tag size={17} /> Era una oferta
        </label>
        <label>
          Observaciones <span className="optional">opcional</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej. oferta de fin de semana"
          />
        </label>
        <p className="field-hint">
          Este es un precio registrado, no una garantía del precio actual.
        </p>
        <Actions
          busy={busy}
          onClose={onClose}
          label={record ? "Guardar corrección" : "Guardar precio"}
        />
      </form>
    </Modal>
  );
}
export function StoreForm({
  store,
  onClose,
  onSaved,
}: Common & { store?: Store }) {
  const [name, setName] = useState(store?.name ?? ""),
    [notes, setNotes] = useState(store?.notes ?? ""),
    [active, setActive] = useState(store ? Boolean(store.active) : true);
  const { busy, error, submit } = useSubmit(onSaved);
  return (
    <Modal
      title={store ? "Editar supermercado" : "Añadir supermercado"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) =>
          submit(
            e,
            () =>
              api(
                store ? `/stores/${store.id}` : "/stores",
                store ? "PUT" : "POST",
                { name, notes, active },
              ),
            store ? "Supermercado actualizado" : "Supermercado y lista creados",
          )
        }
      >
        {error && <ErrorBox message={error} />}
        <label>
          Nombre
          <input
            autoFocus
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu supermercado"
          />
        </label>
        <label>
          Notas <span className="optional">opcional</span>
          <textarea
            maxLength={2000}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {store && (
          <label className="check-line">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />{" "}
            Comercio activo
          </label>
        )}
        {store && (
          <p className="field-hint">
            Al desactivarlo se conservan su lista y todos sus precios. Puedes
            reactivarlo cuando quieras.
          </p>
        )}
        <Actions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}
export function CategoryForm({
  category,
  onClose,
  onSaved,
}: Common & { category?: Category }) {
  const [name, setName] = useState(category?.name ?? "");
  const { busy, error, submit } = useSubmit(onSaved);
  return (
    <Modal
      title={category ? "Editar categoría" : "Nueva categoría"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) =>
          submit(
            e,
            () =>
              api(
                category ? `/categories/${category.id}` : "/categories",
                category ? "PUT" : "POST",
                { name },
              ),
            "Categoría guardada",
          )
        }
      >
        {error && <ErrorBox message={error} />}
        <label>
          Nombre
          <input
            required
            autoFocus
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Actions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}
export function ItemForm({ item, onClose, onSaved }: Common & { item: Item }) {
  const [quantity, setQuantity] = useState(item.quantity),
    [notes, setNotes] = useState(item.notes);
  const { busy, error, submit } = useSubmit(onSaved);
  return (
    <Modal
      title={item.name}
      subtitle="Detalles de este artículo en esta lista."
      onClose={onClose}
    >
      <form
        onSubmit={(e) =>
          submit(
            e,
            () => api(`/items/${item.id}`, "PUT", { quantity, notes }),
            "Artículo actualizado",
          )
        }
      >
        {error && <ErrorBox message={error} />}
        <label>
          Cantidad a comprar
          <input
            autoFocus
            required
            type="number"
            min="1"
            max="999"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </label>
        <label>
          Notas de esta lista
          <textarea
            maxLength={2000}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <Actions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}
export function AddProducts({
  listId,
  already,
  onCreate,
  onClose,
  onSaved,
}: Common & { listId: number; already: number[]; onCreate: () => void }) {
  const [search, setSearch] = useState(""),
    [products, setProducts] = useState<Product[]>([]),
    [quantity, setQuantity] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [added, setAdded] = useState<number[]>([]),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    setLoaded(false);
    const timer = window.setTimeout(() => {
      api<Product[]>(`/products?search=${encodeURIComponent(search)}`)
        .then((data) => {
          if (live) {
            setProducts(data);
            setError("");
            setLoaded(true);
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search]);
  return (
    <Modal
      title="Añadir a la lista"
      subtitle="Busca en tu catálogo o crea un producto."
      onClose={() => {
        if (added.length) onSaved("Productos añadidos a la lista");
        else onClose();
      }}
    >
      <div className="search-box">
        <Search size={19} />
        <input
          autoFocus
          aria-label="Buscar productos para añadir"
          placeholder="Busca un producto…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <label className="quantity-add">
        Cantidad a comprar
        <input
          required
          type="number"
          min="1"
          max="999"
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
        />
      </label>
      {error && <ErrorBox message={error} />}
      <div className="picker-results">
        {loaded ? (
          products.map((p) => {
            const present = already.includes(p.id) || added.includes(p.id);
            return (
              <button
                className="picker-row"
                key={p.id}
                disabled={present || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/lists/${listId}/items`, "POST", {
                      product_id: p.id,
                      quantity,
                    });
                    setAdded((a) => [...a, p.id]);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <span className="product-mini">
                  <ShoppingProductIcon />
                </span>
                <span>
                  <strong>{p.name}</strong>
                  <small>{pack(p)}</small>
                </span>
                {present ? (
                  <span className="picker-present">
                    <Check size={16} /> En la lista
                  </span>
                ) : (
                  <Plus size={22} />
                )}
              </button>
            );
          })
        ) : (
          <p className="field-hint">Buscando…</p>
        )}
        {loaded && !products.length && (
          <p className="field-hint">
            No hay productos que coincidan. Puedes crear uno.
          </p>
        )}
      </div>
      <button
        className="button secondary full"
        onClick={() => {
          if (added.length) onSaved("Productos añadidos");
          onCreate();
        }}
      >
        <Plus size={18} /> Crear un producto nuevo
      </button>
      {added.length > 0 && (
        <button
          className="button primary full"
          onClick={() => onSaved("Productos añadidos a la lista")}
        >
          Listo · {added.length}{" "}
          {added.length === 1 ? "producto añadido" : "productos añadidos"}
        </button>
      )}
    </Modal>
  );
}
function ShoppingProductIcon() {
  return <Tag size={18} strokeWidth={1.5} />;
}
