import { useEffect, useState } from "react";
import ListingsPage from "./components/ListingsPage";
import AdminPage from "./components/AdminPage";
import TrackingPage from "./components/TrackingPage";

const BRONCOS_LOGO = "https://a.espncdn.com/i/teamlogos/nfl/500/den.png";

export default function App() {
  const [route, setRoute] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const isTracking = route === "#/admin/tracking";
  const isAdmin = route === "#/admin" || isTracking;

  let page = <ListingsPage />;
  if (isTracking) page = <TrackingPage />;
  else if (isAdmin) page = <AdminPage />;

  return (
    <div className="app">
      <header className="banner">
        <img className="banner-logo" src={BRONCOS_LOGO} alt="Denver Broncos" />
        <h1>Smigiel Broncos Tickets</h1>
        <nav className="banner-tabs">
          <a href="#/" className={!isAdmin ? "active" : ""}>Listings</a>
          <a href="#/admin" className={isAdmin && !isTracking ? "active" : ""}>Admin</a>
          {isAdmin && (
            <a href="#/admin/tracking" className={isTracking ? "active" : ""}>Tracking</a>
          )}
        </nav>
      </header>
      {isAdmin ? <AdminPage /> : <ListingsPage />}
    </div>
  );
}