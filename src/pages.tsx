import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LayoutGrid,
  Leaf,
  ListChecks,
  Package,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBasket,
  SlidersHorizontal,
  Tag,
  Trash2,
} from "lucide-react";
import { api, date, dateTime, money, number, oldPrice, pack } from "./lib";
import { Brand, Empty, ErrorBox, LinkArrow, Loading } from "./components";
import { ShareList } from "./ShareList";
import type {
  Category,
  Dashboard,
  Item,
  Price,
  Product,
  ProductDetail,
  ShoppingList,
  Store,
} from "./types";

export type DialogState =
  | { type: "product"; product?: Product; defaultList?: number }
  | { type: "price"; productId?: number; storeId?: number; record?: Price }
  | { type: "store"; store?: Store }
  | { type: "category"; category?: Category }
  | { type: "item"; item: Item }
  | { type: "add"; listId: number; already: number[] }
  | {
      type: "confirm";
      title: string;
      text: string;
      action: () => Promise<void>;
    };
type Actions = {
  open: (dialog: DialogState) => void;
  mutate: (
    path: string,
    method: string,
    body?: unknown,
    message?: string,
  ) => Promise<void>;
  revision: number;
};

export function useResource<T>(path: string, revision: number) {
  const [state, setState] = useState<{
    path: string;
    data: T | null;
    error: string;
  }>({ path, data: null, error: "" });
  useEffect(() => {
    let live = true;
    api<T>(path)
      .then((data) => {
        if (live) setState({ path, data, error: "" });
      })
      .catch((e) => {
        if (live)
          setState((s) => ({
            path,
            data: s.path === path ? s.data : null,
            error: e.message,
          }));
      });
    return () => {
      live = false;
    };
  }, [path, revision]);
  return state.path === path ? state : { path, data: null, error: "" };
}
function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
function BagIllustration() {
  return (
    <svg className="bag-illustration" viewBox="0 0 320 230" aria-hidden="true">
      <ellipse
        cx="168"
        cy="207"
        rx="113"
        ry="13"
        fill="#196c52"
        opacity=".08"
      />
      <circle cx="180" cy="109" r="94" fill="#d0e6cd" opacity=".7" />
      <path d="M122 104L104 48q4-18 17-9l20 58" fill="#e3ae55" />
      <path
        d="M119 51l10-6M123 64l10-6M129 78l9-5"
        stroke="#be8436"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M175 105q-37-41-15-64 16 12 15 33 3-38 25-37 5 25-18 49 24-25 39-11 0 20-35 36"
        fill="#448557"
      />
      <path
        d="M171 104q-5-35 22-54"
        fill="none"
        stroke="#286943"
        strokeWidth="3"
      />
      <path d="M205 125l16-67q3-9 11-4l12 5q7 2 3 10l-22 67" fill="#ed9563" />
      <path
        d="M229 57q-6-22 4-28 9 8 1 22 14-21 24-14-1 14-21 21"
        fill="#579768"
      />
      <circle cx="146" cy="101" r="27" fill="#d65d47" />
      <path d="M138 77l7 10 9-11-10 3z" fill="#3e764e" />
      <path d="M80 97q80 18 174 0l-17 101q-75 17-144 0z" fill="#e6c597" />
      <path d="M80 97q85 18 174 0l-5 22q-83 18-165-2z" fill="#d9b37e" />
      <path
        d="M128 134v-19q0-37 40-37t40 37v19"
        fill="none"
        stroke="#a67d51"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path
        d="M137 151q29 31 61 0"
        fill="none"
        stroke="#176b52"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="112" cy="175" r="5" fill="#bb9662" opacity=".5" />
      <path
        d="M58 142l-10-6m215 25l13-5M80 44l-7-10"
        stroke="#7caf86"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function StoreCards({ stores }: { stores: Store[] }) {
  return (
    <div className="stores-grid">
      {stores.map((s) => (
        <a className="store-card" href={`#/list/${s.id}`} key={s.id}>
          <div className="store-card-top">
            <Brand name={s.name} />
            <span className={`status-chip ${s.pending_count ? "has-items" : ""}`}>
              <span />
              {s.pending_count ? "Por comprar" : "Al día"}
            </span>
          </div>
          <h3>{s.name}</h3>
          <p className="store-pending">
            <strong>{s.pending_count}</strong>{" "}
            {s.pending_count === 1 ? "artículo pendiente" : "artículos pendientes"}
          </p>
          <div className="store-estimate">
            <span>Estimación registrada</span>
            <strong>{s.priced_count ? money(s.estimated_cents) : "—"}</strong>
          </div>
          {s.pending_count > s.priced_count && (
            <span className="estimate-note">
              {s.pending_count - s.priced_count} sin precio conocido
            </span>
          )}
          <div className="store-card-link">
            Abrir mi lista <LinkArrow />
          </div>
        </a>
      ))}
    </div>
  );
}

export function PendingListsPage({ stores }: { stores: Store[] }) {
  const pending = stores.filter((store) => store.active && store.pending_count);
  return (
    <>
      <PageHeading
        eyebrow="MIS LISTAS"
        title="Tus compras pendientes"
        description="Elige un supermercado para ver lo que te falta por comprar."
      />
      <StoreCards stores={pending} />
      {!pending.length && (
        <Empty
          title="Todo al día"
          text="No tienes artículos pendientes en tus supermercados activos."
          action={
            <a className="button primary" href="#/">
              Ver mis supermercados
            </a>
          }
        />
      )}
    </>
  );
}

export function Home({
  dashboard,
  ...actions
}: Actions & { dashboard: Dashboard }) {
  const active = dashboard.stores.filter((s) => s.active),
    pending = active.reduce((n, s) => n + s.pending_count, 0);
  return (
    <>
      <PageHeading
        eyebrow="TU ESPACIO DE COMPRA"
        title="Tu compra, en orden."
        description="Todas tus listas. Los precios que recuerdas. Un poco más fácil."
      >
        <button
          className="button primary"
          onClick={() => actions.open({ type: "product" })}
        >
          <Plus size={19} /> Nuevo producto
        </button>
      </PageHeading>
      <section className="home-hero">
        <div>
          <span className="hero-label">
            <Leaf size={15} /> COMPRAR CON CALMA
          </span>
          <h2>
            Menos olvidos.
            <br />
            Mejores decisiones.
          </h2>
          <p>
            Apunta lo que necesitas y compara los precios
            <br className="desktop-only" /> que has registrado en tus
            supermercados.
          </p>
          <a className="hero-link" href="#/prices">
            Consultar mis precios <ArrowUpRight size={17} />
          </a>
        </div>
        <BagIllustration />
      </section>
      <div className="summary-grid">
        <a className="summary-card" href="#/lists">
          <span className="stat-icon green">
            <ListChecks size={22} />
          </span>
          <div>
            <strong>{pending}</strong>
            <span>Artículos pendientes</span>
          </div>
          <span className="stat-caption">En todas tus listas</span>
        </a>
        <a className="summary-card" href="#/settings">
          <span className="stat-icon amber">
            <ShoppingBasket size={22} />
          </span>
          <div>
            <strong>{active.length}</strong>
            <span>Supermercados</span>
          </div>
          <span className="stat-caption">Tus comercios activos</span>
        </a>
        <a className="summary-card" href="#/catalog">
          <span className="stat-icon lavender">
            <Package size={22} />
          </span>
          <div>
            <strong>{dashboard.product_count}</strong>
            <span>Productos en el catálogo</span>
          </div>
          <span className="stat-caption link">
            Ver catálogo <ChevronRight size={14} />
          </span>
        </a>
      </div>
      <div className="section-heading">
        <div>
          <h2>
            Tus supermercados{" "}
            <span className="count-bubble">{active.length}</span>
          </h2>
          <p>Una lista para cada parada.</p>
        </div>
        <button
          className="text-button"
          onClick={() => actions.open({ type: "store" })}
        >
          <Plus size={17} /> Añadir supermercado
        </button>
      </div>
      <StoreCards stores={active} />
      {!active.length && (
        <Empty
          title="Tu primera parada"
          text="Añade un supermercado para empezar a organizar tus compras."
          action={
            <button
              className="button primary"
              onClick={() => actions.open({ type: "store" })}
            >
              <Plus size={18} /> Añadir supermercado
            </button>
          }
        />
      )}
      <div className="home-bottom">
        <section className="panel recent-panel">
          <div className="section-heading compact">
            <h2>
              <Clock3 size={19} /> Últimos precios registrados
            </h2>
            <a className="text-button" href="#/prices">
              Ver todos <LinkArrow />
            </a>
          </div>
          {dashboard.recent_prices.length ? (
            dashboard.recent_prices.map((p) => (
              <a
                key={p.id}
                className="recent-row"
                href={`#/product/${p.product_id}`}
              >
                <Brand name={p.store_name} small />
                <span className="recent-product">
                  <strong>{p.product_name}</strong>
                  <small>
                    {p.store_name} · {date(p.recorded_at)}
                  </small>
                </span>
                <strong>{money(p.cents)}</strong>
                <ChevronRight size={16} />
              </a>
            ))
          ) : (
            <div className="recent-empty">
              <span className="soft-icon">
                <Tag size={24} />
              </span>
              <div>
                <h3>El primer precio es el comienzo</h3>
                <p>
                  Cuando registres precios, podrás verlos y compararlos aquí.
                </p>
                <a className="text-button" href="#/prices">
                  Empezar a registrar <ArrowUpRight size={15} />
                </a>
              </div>
            </div>
          )}
        </section>
        <aside className="tip-card">
          <span className="tip-label">
            <Leaf size={17} /> UN PEQUEÑO HÁBITO
          </span>
          <h3>
            ¿Lo has visto
            <br />
            más barato?
          </h3>
          <p>
            Guarda el precio y su fecha. La próxima vez que compres, tendrás una
            referencia a mano.
          </p>
          <span className="tip-footer">Tu memoria de precios, sin prisa.</span>
        </aside>
      </div>
    </>
  );
}
export function Catalog({
  products,
  categories,
  ...actions
}: Actions & { products: Product[]; categories: Category[] }) {
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState(0);
  const normalize = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const filtered = products.filter(
    (p) =>
      (!category || p.category_id === category) &&
      normalize(`${p.name} ${p.brand} ${p.ean ?? ""}`).includes(
        normalize(search),
      ),
  );
  return (
    <>
      <PageHeading
        eyebrow="UN CATÁLOGO PARA TODAS TUS LISTAS"
        title="Tus productos."
        description="Guarda cada formato una vez. Reutilízalo siempre que lo necesites."
      >
        <button
          className="button primary"
          onClick={() => actions.open({ type: "product" })}
        >
          <Plus size={19} /> Nuevo producto
        </button>
      </PageHeading>
      <div className="filter-bar">
        <div className="search-box">
          <Search size={19} />
          <input
            autoFocus
            aria-label="Buscar en el catálogo"
            placeholder="Buscar por nombre, marca o EAN…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="filter-select">
          <SlidersHorizontal size={17} />
          <select
            aria-label="Filtrar por categoría"
            value={category}
            onChange={(e) => setCategory(Number(e.target.value))}
          >
            <option value="0">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="result-count">
        {filtered.length} {filtered.length === 1 ? "producto" : "productos"}
        {search && ` para «${search}»`}
      </div>
      <div className="catalog-grid">
        {filtered.map((p) => (
          <a className="product-card" key={p.id} href={`#/product/${p.id}`}>
            <div className="product-card-top">
              <span className="category-icon">
                <Package size={25} strokeWidth={1.5} />
              </span>
              <span className="category-chip">{p.category_name}</span>
            </div>
            <h3>{p.name}</h3>
            <p>{pack(p)}</p>
            <div className="product-card-footer">
              <span>
                {p.lists?.length
                  ? `En ${p.lists.length} ${p.lists.length === 1 ? "lista" : "listas"}`
                  : "Sin añadir a listas"}
              </span>
              <ChevronRight size={18} />
            </div>
          </a>
        ))}
      </div>
      {!filtered.length && (
        <Empty
          title={
            products.length
              ? "No encontramos ese producto"
              : "Todo empieza con un producto"
          }
          text={
            products.length
              ? "Prueba con otro nombre o categoría."
              : "Crea el primer producto y elige en qué supermercados necesitas comprarlo."
          }
          action={
            <button
              className="button primary"
              onClick={() => actions.open({ type: "product" })}
            >
              <Plus size={18} /> Crear producto
            </button>
          }
        />
      )}
    </>
  );
}
export function ListPage({
  storeId,
  ...actions
}: Actions & { storeId: number }) {
  const { data, error } = useResource<ShoppingList>(
    `/stores/${storeId}/list`,
    actions.revision,
  );
  const [sort, setSort] = useState("category"),
    [busyItems, setBusyItems] = useState<Set<number>>(new Set());
  const [localError, setLocalError] = useState("");
  if (!data) return error ? <ErrorBox message={error} /> : <Loading />;
  const pending = data.items.filter((i) => !i.purchased),
    bought = data.items.filter((i) => i.purchased);
  const priced = pending.filter((i) =>
    i.prices.some((p) => p.store_id === storeId),
  );
  const estimate = priced.reduce(
    (sum, i) =>
      sum + i.prices.find((p) => p.store_id === storeId)!.cents * i.quantity,
    0,
  );
  const sorted = (items: Item[]) =>
    [...items].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, "es")
        : sort === "category"
          ? a.category_name.localeCompare(b.category_name, "es") ||
            a.name.localeCompare(b.name, "es")
          : a.position - b.position || a.id - b.id,
    );
  const update = async (item: Item, body: unknown) => {
    setBusyItems((s) => new Set(s).add(item.id));
    setLocalError("");
    try {
      await actions.mutate(`/items/${item.id}`, "PUT", body);
    } catch (e) {
      setLocalError((e as Error).message);
    } finally {
      setBusyItems((s) => {
        const next = new Set(s);
        next.delete(item.id);
        return next;
      });
    }
  };
  const move = async (item: Item, delta: number) => {
    const order = [...data.items].sort(
        (a, b) => a.position - b.position || a.id - b.id,
      ),
      index = order.findIndex((i) => i.id === item.id),
      next = index + delta;
    if (next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    try {
      await actions.mutate(`/lists/${data.list.id}/order`, "PUT", {
        item_ids: order.map((i) => i.id),
      });
    } catch (e) {
      setLocalError((e as Error).message);
    }
  };
  const row = (item: Item) => {
    const current = item.prices.find((p) => p.store_id === storeId);
    const cheaper =
      current &&
      item.prices.find(
        (p) =>
          p.store_id !== storeId && p.store_active && p.cents < current.cents,
      );
    return (
      <article
        className={`list-row ${item.purchased ? "purchased" : ""}`}
        key={item.id}
      >
        <button
          className="check-item"
          role="checkbox"
          aria-checked={Boolean(item.purchased)}
          aria-label={`${item.purchased ? "Desmarcar" : "Marcar comprado"} ${item.name}`}
          disabled={busyItems.has(item.id) || !data.store.active}
          onClick={() => update(item, { purchased: !item.purchased })}
        >
          {item.purchased ? <Check size={22} /> : <span />}
        </button>
        <div className="list-product">
          <a href={`#/product/${item.product_id}`}>
            <strong>{item.name}</strong>
          </a>
          <span className="product-meta">{pack(item)}</span>
          {item.notes && <small className="item-note">{item.notes}</small>}
          {cheaper && (
            <a className="cheaper-hint" href={`#/product/${item.product_id}`}>
              <ArrowDown size={14} /> {money(current!.cents - cheaper.cents)}{" "}
              menos en {cheaper.store_name}
              <span>· {date(cheaper.recorded_at)}</span>
            </a>
          )}
          {!current && item.prices.some((p) => p.store_id !== storeId) && (
            <a className="other-prices" href={`#/product/${item.product_id}`}>
              Ver precios en otras tiendas <ChevronRight size={13} />
            </a>
          )}
        </div>
        <div className="quantity-control">
          <button
            aria-label={`Reducir cantidad de ${item.name}`}
            disabled={
              item.quantity <= 1 || busyItems.has(item.id) || !data.store.active
            }
            onClick={() => update(item, { quantity: item.quantity - 1 })}
          >
            −
          </button>
          <span aria-label={`Cantidad: ${item.quantity}`}>{item.quantity}</span>
          <button
            aria-label={`Aumentar cantidad de ${item.name}`}
            disabled={
              item.quantity >= 999 ||
              busyItems.has(item.id) ||
              !data.store.active
            }
            onClick={() => update(item, { quantity: item.quantity + 1 })}
          >
            +
          </button>
        </div>
        <button
          className={`item-price ${current && oldPrice(current.recorded_at) ? "old" : ""}`}
          onClick={() =>
            actions.open({ type: "price", productId: item.product_id, storeId })
          }
          aria-label={`Actualizar precio de ${item.name}`}
        >
          <strong>
            {current ? (
              money(current.cents)
            ) : (
              <>
                <Plus size={13} /> Precio
              </>
            )}
          </strong>
          <small>
            {current
              ? `${oldPrice(current.recorded_at) ? "Antiguo · " : ""}${date(current.recorded_at)}`
              : "Sin registrar"}
          </small>
        </button>
        <div className="item-actions">
          {sort === "manual" && (
            <>
              <button
                className="icon-button"
                aria-label={`Subir ${item.name}`}
                onClick={() => move(item, -1)}
              >
                <ArrowUp size={17} />
              </button>
              <button
                className="icon-button"
                aria-label={`Bajar ${item.name}`}
                onClick={() => move(item, 1)}
              >
                <ArrowDown size={17} />
              </button>
            </>
          )}
          <button
            className="icon-button"
            aria-label={`Editar cantidad y notas de ${item.name}`}
            onClick={() => actions.open({ type: "item", item })}
            disabled={!data.store.active}
          >
            <Pencil size={16} />
          </button>
          <button
            className="icon-button"
            aria-label={`Quitar ${item.name} de la lista`}
            onClick={() =>
              actions.open({
                type: "confirm",
                title: "¿Quitar de esta lista?",
                text: "El producto seguirá en el catálogo y su historial de precios se conservará.",
                action: () =>
                  actions.mutate(
                    `/items/${item.id}`,
                    "DELETE",
                    undefined,
                    "Producto retirado de esta lista",
                  ),
              })
            }
          >
            <Trash2 size={16} />
          </button>
        </div>
      </article>
    );
  };
  const grouped = sorted(pending);
  return (
    <>
      <a className="back-link" href="#/">
        <ChevronLeft size={16} /> Mis supermercados
      </a>
      <PageHeading
        eyebrow="MI LISTA DE LA COMPRA"
        title={data.store.name}
        description={
          data.store.notes || "Lo que necesitas para tu próxima compra."
        }
      >
        <ShareList store={data.store.name} items={grouped} />
        <button
          className="button primary"
          disabled={!data.store.active}
          onClick={() =>
            actions.open({
              type: "add",
              listId: data.list.id,
              already: data.items.map((i) => i.product_id),
            })
          }
        >
          <Plus size={20} /> Añadir productos
        </button>
      </PageHeading>
      {!data.store.active && (
        <div className="notice">
          Este comercio está desactivado. Puedes reactivarlo en Configuración.
        </div>
      )}
      <div className="list-summary">
        <div>
          <ListChecks size={22} />
          <strong>{pending.length}</strong>
          <span>pendientes</span>
        </div>
        <div>
          <Check size={21} />
          <strong>{bought.length}</strong>
          <span>comprados</span>
        </div>
        <div className="list-total">
          <span>Gasto estimado</span>
          <strong>{priced.length ? money(estimate) : "—"}</strong>
          <small>
            {priced.length} de {pending.length} artículos con precio registrado
          </small>
        </div>
      </div>
      <a
        className="text-button store-prices-link"
        href={`#/prices?store=${storeId}`}
      >
        <Tag size={16} /> Todos los precios de este comercio <LinkArrow />
      </a>
      <div className="list-toolbar">
        <h2>
          Por comprar <span className="count-bubble">{pending.length}</span>
        </h2>
        <label className="sort-control">
          <SlidersHorizontal size={16} />
          <select
            aria-label="Ordenar lista"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="category">Por categoría</option>
            <option value="name">Por nombre</option>
            <option value="manual">Orden manual</option>
          </select>
        </label>
      </div>
      {(error || localError) && <ErrorBox message={error || localError} />}
      <div className="list-items">
        {grouped.map((item, i) => (
          <div key={item.id}>
            {sort === "category" &&
              (i === 0 || grouped[i - 1].category_id !== item.category_id) && (
                <div className="category-divider">
                  <span>{item.category_name}</span>
                </div>
              )}
            {row(item)}
          </div>
        ))}
      </div>
      {!pending.length && (
        <Empty
          title={
            bought.length
              ? "¡Todo en la cesta!"
              : "Una lista lista para empezar"
          }
          text={
            bought.length
              ? "Ya has marcado todos los artículos. Puedes añadir más o vaciar los comprados."
              : "Añade productos del catálogo o crea los que necesitas."
          }
          action={
            data.store.active ? (
              <button
                className="button secondary"
                onClick={() =>
                  actions.open({
                    type: "add",
                    listId: data.list.id,
                    already: data.items.map((i) => i.product_id),
                  })
                }
              >
                <Plus size={18} /> Añadir productos
              </button>
            ) : undefined
          }
        />
      )}
      {!!bought.length && (
        <section className="bought-section">
          <div className="list-toolbar">
            <h2>
              <Check size={18} /> Comprados{" "}
              <span className="count-bubble">{bought.length}</span>
            </h2>
            <button
              className="text-button"
              disabled={!data.store.active}
              onClick={() =>
                actions.open({
                  type: "confirm",
                  title: "¿Vaciar los comprados?",
                  text: "Se quitarán solo los artículos comprados de esta lista. El catálogo, las otras listas y todos los precios se conservarán.",
                  action: () =>
                    actions.mutate(
                      `/lists/${data.list.id}/purchased`,
                      "DELETE",
                      { confirm: true },
                      "Comprados retirados de la lista",
                    ),
                })
              }
            >
              <Trash2 size={16} /> Vaciar comprados
            </button>
          </div>
          <div className="list-items">{sorted(bought).map(row)}</div>
        </section>
      )}
      <p className="price-footnote">
        <Clock3 size={14} /> Las estimaciones usan precios históricos del envase
        × cantidad. Pueden haber cambiado; no incluyen artículos sin precio.
      </p>
    </>
  );
}
export function ProductPage({
  productId,
  stores,
  ...actions
}: Actions & { productId: number; stores: Store[] }) {
  const { data, error } = useResource<ProductDetail>(
    `/products/${productId}`,
    actions.revision,
  );
  const [historyStore, setHistoryStore] = useState(0);
  if (!data) return error ? <ErrorBox message={error} /> : <Loading />;
  const { product, latest, history, lists } = data,
    active = latest.filter((p) => p.store_active);
  const min = active[0]?.cents;
  const activeStores = stores.filter((s) => s.active),
    unknown = activeStores.filter(
      (s) => !latest.some((p) => p.store_id === s.id),
    );
  return (
    <>
      <a className="back-link" href="#/catalog">
        <ChevronLeft size={16} /> Catálogo
      </a>
      <PageHeading
        eyebrow={product.category_name.toUpperCase()}
        title={product.name}
        description={pack(product)}
      >
        <button
          className="button secondary"
          onClick={() =>
            actions.open({ type: "product", product: { ...product, lists } })
          }
        >
          <Pencil size={17} /> Editar
        </button>
        <button
          className="button primary"
          onClick={() => actions.open({ type: "price", productId })}
        >
          <Plus size={18} /> Registrar precio
        </button>
      </PageHeading>
      {error && <ErrorBox message={error} />}
      {(product.notes || product.ean) && (
        <div className="product-notes">
          {product.notes && <p>{product.notes}</p>}
          {product.ean && <small>EAN {product.ean}</small>}
        </div>
      )}
      <section>
        <div className="section-heading">
          <div>
            <h2>Un producto, distintos precios</h2>
            <p>
              Último precio registrado en cada comercio para este mismo envase.
            </p>
          </div>
        </div>
        <div className="comparison-grid">
          {latest.map((p) => (
            <div
              className={`comparison-card ${p.store_active && p.cents === min ? "best" : ""}`}
              key={p.id}
            >
              <div className="comparison-top">
                <Brand name={p.store_name} small />
                <strong>{p.store_name}</strong>
                {p.store_active && p.cents === min && (
                  <span className="best-label">Menor registrado</span>
                )}
              </div>
              <strong className="comparison-price">{money(p.cents)}</strong>
              <span className="unit-price">
                {money(p.unit_price!.cents)} / {p.unit_price!.unit}
              </span>
              <p
                className={oldPrice(p.recorded_at) ? "old-date" : "record-date"}
              >
                <Clock3 size={14} /> {date(p.recorded_at)}
                {oldPrice(p.recorded_at) && <span>Precio antiguo</span>}
              </p>
              {p.difference && p.difference.cents > 0 && (
                <p className="price-difference">
                  {money(p.difference.cents)} más que el menor
                  {p.difference.percent !== null && (
                    <span> · {number(p.difference.percent)} % del precio</span>
                  )}
                </p>
              )}
              {p.on_sale ? (
                <span className="sale-label">
                  <Tag size={13} /> Registrado en oferta
                </span>
              ) : null}
              {!p.store_active && (
                <small className="muted">
                  Comercio inactivo · excluido del menor
                </small>
              )}
              <button
                className="text-button"
                onClick={() =>
                  actions.open({
                    type: "price",
                    productId,
                    storeId: p.store_id,
                  })
                }
              >
                <Plus size={16} /> Actualizar precio
              </button>
            </div>
          ))}
          {unknown.map((s) => (
            <div className="comparison-card unknown" key={s.id}>
              <div className="comparison-top">
                <Brand name={s.name} small />
                <strong>{s.name}</strong>
              </div>
              <strong className="comparison-price">—</strong>
              <p>Sin precio registrado</p>
              <button
                className="text-button"
                onClick={() =>
                  actions.open({ type: "price", productId, storeId: s.id })
                }
              >
                <Plus size={16} /> Registrar precio
              </button>
            </div>
          ))}
        </div>
        <div className="notice subtle">
          <Clock3 size={17} />
          <span>
            Son referencias históricas, no precios actuales garantizados. Los
            registros de más de 30 días aparecen como antiguos.
          </span>
        </div>
      </section>
      <div className="detail-columns">
        <section className="panel">
          <div className="section-heading compact">
            <h2>
              <ListChecks size={19} /> En tus listas
            </h2>
            <button
              className="text-button"
              onClick={() =>
                actions.open({
                  type: "product",
                  product: { ...product, lists },
                })
              }
            >
              <Plus size={16} /> Añadir
            </button>
          </div>
          {lists.length ? (
            lists.map((l) => (
              <a
                className="association-row"
                href={`#/list/${l.store_id}`}
                key={l.list_id}
              >
                <Brand name={l.store_name} small />
                <span>
                  <strong>{l.store_name}</strong>
                  <small>
                    {l.quantity} {l.quantity === 1 ? "envase" : "envases"} ·{" "}
                    {l.purchased ? "Comprado" : "Pendiente"}
                  </small>
                </span>
                <LinkArrow />
              </a>
            ))
          ) : (
            <p className="panel-copy">
              No está en ninguna lista. Puedes añadirlo sin volver a crearlo.
            </p>
          )}
        </section>
        <section className="panel">
          <div className="section-heading compact">
            <h2>
              <Clock3 size={19} /> Historial de precios
            </h2>
          </div>
          <select
            className="history-filter"
            aria-label="Filtrar historial por supermercado"
            value={historyStore}
            onChange={(e) => setHistoryStore(Number(e.target.value))}
          >
            <option value="0">Todos los supermercados</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {history
            .filter((p) => !historyStore || p.store_id === historyStore)
            .map((p) => (
              <div className="history-row" key={p.id}>
                <span>
                  <strong>{p.store_name}</strong>
                  <small>
                    {dateTime(p.recorded_at)}
                    {p.on_sale ? " · Oferta" : ""}
                  </small>
                  {p.notes && <small>{p.notes}</small>}
                </span>
                <strong>{money(p.cents)}</strong>
                <button
                  className="icon-button"
                  aria-label={`Corregir precio ${money(p.cents)} en ${p.store_name}`}
                  onClick={() => actions.open({ type: "price", record: p })}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Eliminar precio ${money(p.cents)} en ${p.store_name}`}
                  onClick={() =>
                    actions.open({
                      type: "confirm",
                      title: "¿Eliminar este precio?",
                      text: "Se eliminará únicamente este registro erróneo. Los demás precios se conservarán.",
                      action: () =>
                        actions.mutate(
                          `/prices/${p.id}`,
                          "DELETE",
                          undefined,
                          "Registro de precio eliminado",
                        ),
                    })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          {!history.filter((p) => !historyStore || p.store_id === historyStore)
            .length && (
            <p className="panel-copy">
              Todavía no hay registros para esta selección.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
export function PricesPage({
  products,
  stores,
  storeId = 0,
  ...actions
}: Actions & { products: Product[]; stores: Store[]; storeId?: number }) {
  const [selected, setSelected] = useState(storeId),
    [search, setSearch] = useState("");
  const records = useResource<Price[]>(
    selected ? `/prices?store_id=${selected}` : "/prices",
    actions.revision,
  );
  const matched = products.filter((p) =>
    `${p.name} ${p.brand}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="TU MEMORIA DE PRECIOS"
        title="Compra con referencias."
        description="Compara lo que has registrado, siempre con su fecha."
      >
        <button
          className="button primary"
          disabled={!products.length || !stores.some((s) => s.active)}
          onClick={() =>
            actions.open({ type: "price", storeId: selected || undefined })
          }
        >
          <Plus size={19} /> Registrar precio
        </button>
      </PageHeading>
      <div className="price-intro">
        <span className="stat-icon green">
          <Tag size={25} />
        </span>
        <div>
          <h2>El mismo producto. El mismo formato.</h2>
          <p>
            Selecciona un producto para comparar los últimos precios conocidos y
            consultar su historial.
          </p>
        </div>
      </div>
      <div className="filter-bar">
        <div className="search-box">
          <Search size={19} />
          <input
            aria-label="Buscar producto para comparar"
            placeholder="Busca el producto que quieres comparar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="filter-select">
          <ShoppingBasket size={17} />
          <select
            aria-label="Precios de un supermercado"
            value={selected}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            <option value="0">Comparar por producto</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {!s.active ? " (inactivo)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {selected ? (
        <>
          {records.error && <ErrorBox message={records.error} />}
          {!records.data ? (
            <Loading />
          ) : (
            <div className="price-product-list">
              {records.data
                .filter((p) =>
                  `${p.product_name} ${p.brand}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((p) => (
                  <a
                    href={`#/product/${p.product_id}`}
                    className="price-product-row"
                    key={p.id}
                  >
                    <span className="category-icon">
                      <Tag size={22} />
                    </span>
                    <span>
                      <strong>{p.product_name}</strong>
                      <small>
                        {pack({
                          package_amount: p.package_amount!,
                          unit: p.unit!,
                          brand: p.brand,
                        })}{" "}
                        · {date(p.recorded_at)}
                        {oldPrice(p.recorded_at) ? " · Precio antiguo" : ""}
                        {p.on_sale ? " · Oferta" : ""}
                      </small>
                    </span>
                    <strong>{money(p.cents)}</strong>
                    <LinkArrow />
                  </a>
                ))}
            </div>
          )}
          {records.data && !records.data.length && (
            <Empty
              title="Todavía sin precios"
              text="Puedes registrar cualquier producto aquí, aunque no lo tengas en esta lista."
            />
          )}
        </>
      ) : (
        <>
          <div className="price-product-list">
            {matched.map((p) => (
              <a
                href={`#/product/${p.id}`}
                className="price-product-row"
                key={p.id}
              >
                <span className="category-icon">
                  <Package size={22} />
                </span>
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {pack(p)} · {p.category_name}
                  </small>
                </span>
                <span className="compare-label">
                  Comparar precios <LinkArrow />
                </span>
              </a>
            ))}
          </div>
          {!matched.length && (
            <Empty
              title={
                products.length
                  ? "No encontramos ese producto"
                  : "Empieza tu memoria de precios"
              }
              text={
                products.length
                  ? "Prueba con otro nombre."
                  : "Crea un producto y registra el precio que has visto en cualquier supermercado."
              }
              action={
                <button
                  className="button primary"
                  onClick={() => actions.open({ type: "product" })}
                >
                  <Plus size={18} /> Crear producto
                </button>
              }
            />
          )}
        </>
      )}
    </>
  );
}
export function SettingsPage({
  stores,
  categories,
  theme,
  toggleTheme,
  ...actions
}: Actions & {
  stores: Store[];
  categories: Category[];
  theme: string;
  toggleTheme: () => void;
}) {
  return (
    <>
      <PageHeading
        eyebrow="A TU MANERA"
        title="Tu espacio, tus reglas."
        description="Gestiona tus supermercados, organiza categorías y cuida tus datos."
      />
      <div className="settings-grid">
        <section className="panel">
          <div className="section-heading compact">
            <h2>
              <ShoppingBasket size={19} /> Supermercados
            </h2>
            <button
              className="text-button"
              onClick={() => actions.open({ type: "store" })}
            >
              <Plus size={16} /> Añadir
            </button>
          </div>
          {stores.map((s) => (
            <div
              className={`settings-row ${!s.active ? "inactive" : ""}`}
              key={s.id}
            >
              <Brand name={s.name} small />
              <span>
                <strong>{s.name}</strong>
                <small>
                  {s.active
                    ? `${s.pending_count} pendientes`
                    : "Desactivado · datos conservados"}
                </small>
              </span>
              <button
                className="icon-button"
                aria-label={`Editar ${s.name}`}
                onClick={() => actions.open({ type: "store", store: s })}
              >
                <Pencil size={17} />
              </button>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="section-heading compact">
            <h2>
              <LayoutGrid size={19} /> Categorías
            </h2>
            <button
              className="text-button"
              onClick={() => actions.open({ type: "category" })}
            >
              <Plus size={16} /> Añadir
            </button>
          </div>
          {categories.map((c) => (
            <div className="settings-row" key={c.id}>
              <span>
                <strong>{c.name}</strong>
                <small>{c.product_count} productos</small>
              </span>
              <button
                className="icon-button"
                aria-label={`Editar categoría ${c.name}`}
                onClick={() => actions.open({ type: "category", category: c })}
              >
                <Pencil size={16} />
              </button>
              <button
                className="icon-button"
                aria-label={`Eliminar categoría ${c.name}`}
                disabled={c.product_count > 0}
                title={
                  c.product_count
                    ? "Cambia de categoría los productos antes de eliminarla"
                    : "Eliminar categoría"
                }
                onClick={() =>
                  actions.open({
                    type: "confirm",
                    title: "¿Eliminar categoría?",
                    text: "Solo se pueden eliminar categorías sin productos asociados.",
                    action: () =>
                      actions.mutate(
                        `/categories/${c.id}`,
                        "DELETE",
                        undefined,
                        "Categoría eliminada",
                      ),
                  })
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="section-heading compact">
            <h2>Apariencia</h2>
          </div>
          <div className="settings-row">
            <span>
              <strong>{theme === "dark" ? "Modo oscuro" : "Modo claro"}</strong>
              <small>Se recuerda en este dispositivo</small>
            </span>
            <button className="button secondary" onClick={toggleTheme}>
              Cambiar a {theme === "dark" ? "claro" : "oscuro"}
            </button>
          </div>
        </section>
        <section className="panel maintenance">
          <div className="section-heading compact">
            <h2>
              <ShieldCheck size={19} /> Tus datos, en casa
            </h2>
          </div>
          <p>
            Las listas y los precios se guardan en la base de datos de tu
            servidor. Todos los dispositivos conectados usan el mismo espacio
            familiar.
          </p>
          <p>
            Para hacer copias consistentes, restaurarlas o actualizar el
            contenedor, sigue las instrucciones del README del proyecto. Una
            copia del navegador no protege la base de datos.
          </p>
          <p className="field-hint">
            Sin cuentas de usuario: restringe el acceso a tu LAN o a
            dispositivos autorizados por Tailscale.
          </p>
        </section>
      </div>
    </>
  );
}
