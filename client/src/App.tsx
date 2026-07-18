import { useEffect, useState } from "react";
import ListingsPage from "./components/ListingsPage";
import AdminPage from "./components/AdminPage";

const BRONCOS_LOGO = "https://a.espncdn.com/i/teamlogos/nfl/500/den.png";

export default function App() {
  const [route, setRoute] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const isAdmin = route === "#/admin";

  return (
    <div className="app">
      <header className="banner">
        <img className="banner-logo" src={BRONCOS_LOGO} alt="Denver Broncos" />
        <h1>Smigiel Broncos Tickets</h1>
        <nav className="banner-tabs">
          <a href="#/" className={!isAdmin ? "active" : ""}>Listings</a>
          <a href="#/admin" className={isAdmin ? "active" : ""}>Admin</a>
        </nav>
      </header>
      {isAdmin ? <AdminPage /> : <ListingsPage />}
    </div>
  );
}