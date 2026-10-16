/**
 * App.tsx
 *
 * Root component. Defines top-level routes and the wallet-aware navigation.
 *
 * Routes:
 *   /              → Dashboard (connect wallet, open a job by id)
 *   /post          → PostJob (client creates + funds a new escrow)
 *   /jobs/:id      → JobDetail (milestone tracker, release + dispute)
 *   /profile/:addr → Profile (reputation score)
 */

import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { WalletProvider } from "./hooks/WalletProvider";
import { useWallet } from "./hooks/wallet-context";
import AddressField from "./components/AddressField";
import ThemeToggle from "./components/ThemeToggle";
import Dashboard from "./pages/Dashboard";
import PostJob from "./pages/PostJob";
import JobDetail from "./pages/JobDetail";
import Profile from "./pages/Profile";

function Nav() {
  const { publicKey, connecting, connect, disconnect } = useWallet();
  return (
    <nav className="nav" aria-label="Main navigation">
      <Link to="/">My Jobs</Link>
      <Link to="/post">Post a Job</Link>
      <span className="nav-spacer">
        <ThemeToggle />
        {publicKey ? (
          <>
            <AddressField address={publicKey} truncate />{" "}
            <button onClick={disconnect}>Disconnect</button>
          </>
        ) : (
          <button onClick={() => void connect()} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect Freighter"}
          </button>
        )}
      </span>
    </nav>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <Nav />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/post" element={<PostJob />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/profile/:address" element={<Profile />} />
        </Routes>
      </BrowserRouter>
    </WalletProvider>
  );
}
