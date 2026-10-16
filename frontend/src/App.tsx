/**
 * App.tsx
 *
 * Root component. Defines top-level routes and the wallet-aware navigation.
 *
 * Routes:
 *   /              → Dashboard (connect wallet, open a job by id)
 *   /post          → PostJob (client creates + funds a new escrow)
 *   /activity      → Activity (earnings + open escrows for the wallet, #73)
 *   /jobs/:id      → JobDetail (milestone tracker, release + dispute)
 *   /jobs/:id/receipt → Receipt (printable/exportable record)
 *   /profile/:addr → Profile (reputation score)
 */

import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { WalletProvider } from "./hooks/WalletProvider";
import { ToastProvider } from "./hooks/ToastProvider";
import { useWallet } from "./hooks/wallet-context";
import { useUnread } from "./hooks/useUnread";
import AddressField from "./components/AddressField";
import NotificationsBell from "./components/NotificationsBell";
import Dashboard from "./pages/Dashboard";
import Activity from "./pages/Activity";
import PostJob from "./pages/PostJob";
import JobDetail from "./pages/JobDetail";
import Receipt from "./pages/Receipt";
import Profile from "./pages/Profile";
import FreelancerDirectory from "./pages/FreelancerDirectory";

function Nav() {
  const { publicKey, connecting, connect, disconnect } = useWallet();
  // Unread messages are the one thing a user cannot see from the current page,
  // so the total lives in the nav (issue #64).
  const { total: unread } = useUnread();
  return (
    <nav className="nav">
      <Link to="/">My Jobs</Link>
      <Link to="/activity">Activity</Link>
      <Link to="/post">Post a Job</Link>
      <span className="nav-spacer" style={{ display: "inline-flex", alignItems: "center" }}>
        {publicKey ? (
          <>
            <NotificationsBell />
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
        <Nav />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/freelancers" element={<FreelancerDirectory />} />
          <Route path="/post" element={<PostJob />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/jobs/:id/receipt" element={<Receipt />} />
          <Route path="/profile/:address" element={<Profile />} />
        </Routes>
      </BrowserRouter>
    </WalletProvider>
  );
}
