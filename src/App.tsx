import React, { useState, useEffect } from 'react';
import { AudienceDisplay } from './components/AudienceDisplay.tsx';
import { ControllerConsole } from './components/ControllerConsole.tsx';
import { ResultsPage } from './components/ResultsPage.tsx';
import { HealthDashboard } from './components/HealthDashboard.tsx';
import { PublicParticipantDirectory } from './components/PublicParticipantDirectory.tsx';
import { RestrictedPageBanner } from './components/RestrictedPageBanner.tsx';
import { ExcelSeedPage } from './components/ExcelSeedPage.tsx';
import { RemoteController } from './components/RemoteController.tsx';
import { api } from './services/api.ts';

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname || '/';
    }
    return '/';
  });

  const [pageAccess, setPageAccess] = useState<{
    audience: boolean;
    participants: boolean;
    health: boolean;
    results: boolean;
    restriction_message: string;
  }>({
    audience: true,
    participants: true,
    health: true,
    results: true,
    restriction_message: 'This page is temporarily restricted by the event administrator. Please stay tuned.',
  });

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname || '/');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Fetch page access rules and listen to updates via SSE
  useEffect(() => {
    let isMounted = true;

    const fetchAccess = async () => {
      try {
        const res = await api.getPageAccessStatus('');
        if (res.settings && isMounted) {
          setPageAccess(res.settings);
        }
      } catch {
        // Fallback silently
      }
    };

    fetchAccess();
    const interval = setInterval(fetchAccess, 8000);

    // Listen to real-time events for instant update
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource('/api/public/events');
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'PAGE_ACCESS_UPDATED' && data.payload) {
            setPageAccess((prev) => ({ ...prev, ...data.payload }));
          }
        } catch {}
      };
    } catch {}

    return () => {
      isMounted = false;
      clearInterval(interval);
      if (eventSource) eventSource.close();
    };
  }, []);

  // Continuous telemetry heartbeat
  useEffect(() => {
    const sessionId = `vis_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
    const sendPulse = () => {
      api.sendHeartbeat(sessionId, window.location.pathname || '/');
    };

    sendPulse();
    const pulseInterval = setInterval(sendPulse, 8000);
    return () => clearInterval(pulseInterval);
  }, [currentPath]);

  // Route normalization:
  // / and /draw -> Audience
  // /controller -> Controller
  // /health -> Health
  // /results -> Results
  // /participants, /verify, /search -> Public Participant Directory
  const normalized = currentPath.toLowerCase().replace(/\/+$/, '') || '/';

  // Controller is always unrestricted (it is the admin portal)
  if (normalized === '/remote' || normalized === '/mobile') {
    return <RemoteController />;
  }

  if (normalized === '/controller/seed' || normalized === '/seed') {
    return <ExcelSeedPage />;
  }

  if (normalized === '/controller') {
    return <ControllerConsole />;
  }

  if (normalized === '/results') {
    if (!pageAccess.results) {
      return <RestrictedPageBanner pageName="Results" message={pageAccess.restriction_message} />;
    }
    return <ResultsPage />;
  }

  if (normalized === '/health') {
    if (!pageAccess.health) {
      return <RestrictedPageBanner pageName="Health & Telemetry" message={pageAccess.restriction_message} />;
    }
    return <HealthDashboard />;
  }

  if (
    normalized === '/participants' ||
    normalized === '/verify' ||
    normalized === '/search' ||
    normalized === '/directory'
  ) {
    if (!pageAccess.participants) {
      return <RestrictedPageBanner pageName="Participant Directory" message={pageAccess.restriction_message} />;
    }
    return <PublicParticipantDirectory />;
  }

  // Root / and /draw: Audience Page (Strictly clean presentation stage)
  if (!pageAccess.audience) {
    return <RestrictedPageBanner pageName="Live Audience Stage" message={pageAccess.restriction_message} />;
  }
  return <AudienceDisplay />;
}
