import { useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  House,
  Leaf,
  Moon,
  Package,
  Search,
  Settings2,
  ShoppingBasket,
  Sun,
  Tag,
  WifiOff,
  X,
} from "lucide-react";
import { api } from "./lib";
import type { Category, Dashboard, Product } from "./types";
import {
  AddProducts,
  CategoryForm,
  ItemForm,
  PriceForm,
  ProductForm,
  StoreForm,
} from "./Forms";
import { Confirm, ErrorBox, Loading } from "./components";
import {
  Catalog,
  Home,
  ListPage,
  PricesPage,
  ProductPage,
  SettingsPage,
  useResource,
  type DialogState,
} from "./pages";

const nav = [
  { key: "/", title: "Inicio", icon: House },
  { key: "/catalog", title: "Catálogo", icon: Package },
  { key: "/prices", title: "Precios", icon: Tag },
  { key: "/settings", title: "Configuración", icon: Settings2 },
];
function initialTheme() {
  try {
    return (
      localStorage.getItem("theme") ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light")
    );
  } catch {
    return "light";
  }
}
export default function App() {
  const [route, setRoute] = useState(location.hash.slice(1) || "/"),
    [revision, setRevision] = useState(0),
    [dialog, setDialog] = useState<DialogState | null>(null);
  const [theme, setTheme] = useState(initialTheme),
    [toast, setToast] = useState(""),
    [online, setOnline] = useState(navigator.onLine);
  const dashboard = useResource<Dashboard>("/dashboard", revision),
    categories = useResource<Category[]>("/categories", revision),
    products = useResource<Product[]>("/products", revision);
  useEffect(() => {
    const change = () => {
      setRoute(location.hash.slice(1) || "/");
      setDialog(null);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* Device may block local storage. */
    }
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    const connected = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) setRevision((r) => r + 1);
    };
    const visible = () => {
      if (document.visibilityState === "visible") setRevision((r) => r + 1);
    };
    const timer = window.setInterval(visible, 20000);
    window.addEventListener("online", connected);
    window.addEventListener("offline", connected);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", connected);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        location.hash = "/catalog";
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  const saved = (message: string) => {
    setDialog(null);
    setRevision((r) => r + 1);
    setToast(message);
  };
  const mutate = async (
    path: string,
    method: string,
    body?: unknown,
    message?: string,
  ) => {
    await api(path, method, body);
    setRevision((r) => r + 1);
    if (message) {
      setToast(message);
      setDialog(null);
    }
  };
  const actions = { open: setDialog, mutate, revision };
  const stores = dashboard.data?.stores ?? [],
    cats = categories.data ?? [],
    prods = products.data ?? [];
  const activeKey = route.startsWith("/product")
    ? "/catalog"
    : route.startsWith("/list")
      ? "/"
      : route.split("?")[0];
  const label = nav.find((n) => n.key === activeKey)?.title ?? "La Compra";
  const toggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));
  const error = dashboard.error || categories.error || products.error;
  const ready = dashboard.data && categories.data && products.data;
  const listMatch = /^\/list\/(\d+)$/.exec(route),
    productMatch = /^\/product\/(\d+)$/.exec(route);
  return (
    <div className="app-shell">
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Saltar al contenido
      </a>
      <aside className="sidebar">
        <a href="#/" className="app-brand">
          <span>
            <ShoppingBasket size={25} strokeWidth={1.8} />
          </span>
          <div>
            la compra<span>un poco más fácil.</span>
          </div>
        </a>
        <span className="nav-label">MI ESPACIO</span>
        <nav aria-label="Navegación principal">
          {nav.map((n) => (
            <a
              href={`#${n.key}`}
              key={n.key}
              className={activeKey === n.key ? "active" : ""}
              aria-current={activeKey === n.key ? "page" : undefined}
            >
              <n.icon size={20} strokeWidth={1.8} />
              <span>{n.title}</span>
              {n.key === "/" && (
                <ChevronRight size={15} className="nav-chevron" />
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="sidebar-note-icon">
            <Leaf size={21} />
          </span>
          <strong>
            Todo empieza
            <br />
            con una buena lista.
          </strong>
          <p>
            Tu compra, a tu ritmo.
            <br />Y tus datos, en casa.
          </p>
        </div>
        <div className="sidebar-footer">
          <span className="private-dot" /> Espacio familiar privado
          <span>LA COMPRA · v1.0</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <ShoppingBasket size={17} />
            <span>Mi espacio</span>
            <ChevronRight size={14} />
            <strong>{label}</strong>
          </div>
          <a className="header-search" href="#/catalog">
            <Search size={17} />
            <span>Buscar producto…</span>
            <kbd>Ctrl K</kbd>
          </a>
          <div className="header-tools">
            <button
              className="icon-button"
              onClick={toggleTheme}
              aria-label={`Activar modo ${theme === "light" ? "oscuro" : "claro"}`}
            >
              {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <span className="family-avatar" title="Espacio familiar">
              <House size={18} />
            </span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {!online && (
            <div className="notice offline" role="alert">
              <WifiOff size={18} /> Sin conexión. Reconecta para consultar y
              guardar cambios.
            </div>
          )}
          {error && (
            <ErrorBox message={error} retry={() => setRevision((r) => r + 1)} />
          )}
          {!ready ? (
            !error && <Loading />
          ) : route === "/" ? (
            <Home dashboard={dashboard.data!} {...actions} />
          ) : route === "/catalog" ? (
            <Catalog products={prods} categories={cats} {...actions} />
          ) : route.split("?")[0] === "/prices" ? (
            <PricesPage
              key={route}
              storeId={
                Number(new URLSearchParams(route.split("?")[1]).get("store")) ||
                0
              }
              products={prods}
              stores={stores}
              {...actions}
            />
          ) : route === "/settings" ? (
            <SettingsPage
              stores={stores}
              categories={cats}
              theme={theme}
              toggleTheme={toggleTheme}
              {...actions}
            />
          ) : listMatch ? (
            <ListPage
              key={listMatch[1]}
              storeId={Number(listMatch[1])}
              {...actions}
            />
          ) : productMatch ? (
            <ProductPage
              key={productMatch[1]}
              productId={Number(productMatch[1])}
              stores={stores}
              {...actions}
            />
          ) : (
            <div className="empty-state">
              <h1>Página no encontrada</h1>
              <a className="button primary" href="#/">
                Volver al inicio
              </a>
            </div>
          )}
          <footer className="page-footer">
            <span>
              <Leaf size={14} /> Pequeñas listas. Buenas decisiones.
            </span>
            <span>Hecho para tu día a día.</span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Navegación móvil">
        {nav.map((n) => (
          <a
            href={`#${n.key}`}
            key={n.key}
            className={activeKey === n.key ? "active" : ""}
            aria-current={activeKey === n.key ? "page" : undefined}
          >
            <n.icon size={22} />
            <span>{n.key === "/settings" ? "Ajustes" : n.title}</span>
          </a>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Check size={19} />
          <span>{toast}</span>
          <button aria-label="Cerrar mensaje" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {dialog?.type === "product" && (
        <ProductForm
          product={dialog.product}
          defaultList={dialog.defaultList}
          categories={cats}
          stores={stores}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.type === "price" && (
        <PriceForm
          products={prods}
          stores={stores}
          productId={dialog.productId}
          storeId={dialog.storeId}
          record={dialog.record}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.type === "store" && (
        <StoreForm
          store={dialog.store}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.type === "category" && (
        <CategoryForm
          category={dialog.category}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.type === "item" && (
        <ItemForm
          item={dialog.item}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.type === "add" && (
        <AddProducts
          listId={dialog.listId}
          already={dialog.already}
          onClose={() => setDialog(null)}
          onSaved={saved}
          onCreate={() =>
            setDialog({ type: "product", defaultList: dialog.listId })
          }
        />
      )}
      {dialog?.type === "confirm" && (
        <Confirm
          title={dialog.title}
          text={dialog.text}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await dialog.action();
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
