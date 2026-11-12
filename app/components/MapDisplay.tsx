"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import {
  toggleVenueAttendance, startPreParty, stopPreParty, requestEventAttendance,
  respondToEventRequest, cancelEventRequest,
} from "../actions/map";
import { Check, Users, Flame, X, Clock, MessageCircle, MapPinOff, RefreshCw, Ban } from "lucide-react";
import GuestPaywall from "./GuestPaywall";
import { usePolling } from "@/lib/usePolling";
import { getJson } from "@/lib/apiClient";
import { SLOW_POLL_MS } from "@/lib/liveUpdates";
import { actionErrorKey } from "@/lib/actionErrors";
import { MASK_RADIUS_METERS, PREPARTY_DURATION_CHIPS } from "@/lib/mapConfig";
import type { ErrorCode } from "@/lib/actionResult";
import type { MapDataDTO, MapEventDTO, VenueDTO } from "@/lib/apiTypes";

type Venue = VenueDTO;
type PrePartyEvent = MapEventDTO;

const DEFAULT_CENTER: [number, number] = [49.9929, 8.2473]; // Mainz
const DEFAULT_DURATION_HOURS = 4;

const hasGeolocation = () => typeof navigator !== "undefined" && "geolocation" in navigator;
/** The map center sent to /api/map only needs ~1 km precision. */
const roundCenter = (value: number) => Math.round(value * 100) / 100;

/** Leaflet draws SVG with inline colors, so read the design token once. */
function readToken(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Reports the map center after every pan/zoom. */
function MapCenterTracker({ onMoveEnd }: { onMoveEnd: (center: L.LatLng) => void }) {
  useMapEvents({ moveend: (event) => onMoveEnd(event.target.getCenter()) });
  return null;
}

export default function MapDisplay() {
  const t = useTranslations("Map");
  const tErr = useTranslations("Map.errors");
  const tGeo = useTranslations("GeolocationModal");
  const locale = useLocale();
  const router = useRouter();
  const mapRef = useRef<L.Map | null>(null);

  const [showPaywall, setShowPaywall] = useState(false);
  // Last known position from a previous visit (MapDisplay is client-only: ssr: false).
  const [userPosition, setUserPosition] = useState<[number, number]>(() => {
    try {
      const lat = parseFloat(localStorage.getItem("gloo_user_lat") ?? "");
      const lng = parseFloat(localStorage.getItem("gloo_user_lng") ?? "");
      if (!isNaN(lat) && !isNaN(lng)) return [lat, lng];
    } catch {
      // ignore storage error
    }
    return DEFAULT_CENTER;
  });
  const [locationName, setLocationName] = useState<string>(t("mainzLocation"));
  const [venues, setVenues] = useState<Venue[]>([]);
  const [preParties, setPreParties] = useState<PrePartyEvent[]>([]);
  const [myEvent, setMyEvent] = useState<MapDataDTO["myEvent"]>(null);
  const [loadingActionId, setLoadingActionId] = useState<string | null>(null);

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [partyDescription, setPartyDescription] = useState("");
  const [durationHours, setDurationHours] = useState<number>(DEFAULT_DURATION_HOURS);
  const [isProcessingParty, setIsProcessingParty] = useState(false);
  const [timeLeft, setTimeLeft] = useState<string>("");

  // B11: set from the server (GET /api/map), not guessed on the client.
  const [isGuest, setIsGuest] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [partyColor] = useState(() => readToken("--color-secondary", "#FF8F7E"));

  // Geolocation state. Without a geolocation API the modal starts open, so the
  // mount effect never has to set state synchronously.
  const [showGeoModal, setShowGeoModal] = useState(() => !hasGeolocation());
  const [geoError, setGeoError] = useState<number | null>(() => (hasGeolocation() ? null : 2));
  const [isLocating, setIsLocating] = useState(() => hasGeolocation());

  // Map center for the venue radius (P2), rounded before it leaves the browser.
  const centerRef = useRef<[number, number]>([roundCenter(userPosition[0]), roundCenter(userPosition[1])]);

  // One request (GET /api/map) every SLOW_POLL_MS while the page is visible,
  // on focus, after the map moved, and right after the user's own actions.
  const loadMapData = usePolling(async (signal) => {
    const [lat, lng] = centerRef.current;
    const data = await getJson<MapDataDTO>(`/api/map?lat=${lat}&lng=${lng}`, signal);
    setIsGuest(data.isGuest);
    setVenues(data.venues);
    setPreParties(data.events);
    setMyEvent(data.myEvent);
  }, SLOW_POLL_MS);

  const handleMoveEnd = useCallback((center: L.LatLng) => {
    const next: [number, number] = [roundCenter(center.lat), roundCenter(center.lng)];
    const [lat, lng] = centerRef.current;
    if (next[0] === lat && next[1] === lng) return;
    centerRef.current = next;
    loadMapData();
  }, [loadMapData]);

  /** Asks the browser for the position; all state changes happen in the callbacks. */
  const locate = useCallback(() => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setIsLocating(false);
        setGeoError(null);
        setShowGeoModal(false);

        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setUserPosition([lat, lng]);

        try {
          localStorage.setItem("gloo_user_lat", String(lat));
          localStorage.setItem("gloo_user_lng", String(lng));
        } catch {
          // ignore storage error
        }

        if (mapRef.current) {
          mapRef.current.flyTo([lat, lng], 14, { animate: true });
        }

        // S12: reverse geocoding runs on our server (rounded, throttled,
        // cached); the browser never contacts Nominatim.
        try {
          const coarse = (v: number) => Math.round(v * 1000) / 1000;
          const { name } = await getJson<{ name: string | null }>(
            `/api/geocode?lat=${coarse(lat)}&lng=${coarse(lng)}&lang=${locale}`,
          );
          if (name) setLocationName(name);
        } catch (err) {
          console.error("Error translating location:", err);
        }
      },
      (error) => {
        setIsLocating(false);
        console.error("Geolocation error:", error);
        // Fallback cleanly to default coordinates
        setUserPosition(DEFAULT_CENTER);
        if (mapRef.current) {
          mapRef.current.flyTo(DEFAULT_CENTER, 14, { animate: true });
        }
        setGeoError(error.code);
        setShowGeoModal(true);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, [locale]);

  /** "Try again" in the geolocation modal. */
  const requestLocation = () => {
    if (!hasGeolocation()) {
      setGeoError(2);
      setShowGeoModal(true);
      return;
    }
    setIsLocating(true);
    locate();
  };

  useEffect(() => {
    if (hasGeolocation()) locate();
  }, [locate]);

  const getGeoErrorMessage = () => {
    switch (geoError) {
      case 1:
        return tGeo("permissionDenied");
      case 2:
        return tGeo("positionUnavailable");
      case 3:
        return tGeo("timeout");
      default:
        return tGeo("message");
    }
  };

  useEffect(() => {
    const endTime = myEvent?.endTime;
    if (!endTime) return;
    const interval = setInterval(() => {
      const diff = new Date(endTime).getTime() - new Date().getTime();
      if (diff <= 0) {
        setTimeLeft("00:00:00");
        loadMapData();
        clearInterval(interval);
      } else {
        const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        setTimeLeft(`${h}h ${m}m ${Math.floor((diff % (1000 * 60)) / 1000)}s`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [myEvent, loadMapData]);

  // Custom DivIcon generator to render clean Tailwind circles instead of default image flags
  const createMarkerIcon = (type: "BAR" | "CLUB" | "USER" | "PARTY") => {
    let colorClass = "bg-primary shadow-[0_0_12px_rgba(255,114,94,0.6)]";

    if (type === "CLUB") {
      colorClass = "bg-primary shadow-[0_0_15px_rgba(255,114,94,0.7)]";
    } else if (type === "BAR") {
      colorClass = "bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.7)]";
    } else if (type === "PARTY") {
      colorClass = "bg-secondary shadow-[0_0_20px_rgba(255,143,126,0.9)] animate-pulse";
    }

    const testId = type === "PARTY" ? ' data-testid="preparty-exact-pin"' : "";
    return L.divIcon({
      className: "custom-leaflet-marker",
      html: `<div${testId} class="w-5 h-5 rounded-full border-2 border-background ${colorClass} transition-all duration-300 transform hover:scale-125"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  };

  /** B11: error codes -> Map.errors.* (no raw string matching). */
  const showFailure = (result: { code: ErrorCode; messageKey?: string }) => {
    if (result.code === "UNAUTHORIZED") {
      setShowPaywall(true);
      return;
    }
    setErrorKey(actionErrorKey(result, (key) => tErr.has(key)));
  };

  const handleRsvpToggle = async (venueId: string) => {
    if (isGuest) {
      setShowPaywall(true);
      return;
    }
    setLoadingActionId(venueId);
    const result = await toggleVenueAttendance(venueId);
    if (result.ok) loadMapData();
    else showFailure(result);
    setLoadingActionId(null);
  };

  const openPartySheet = () => {
    if (isGuest) {
      setShowPaywall(true);
      return;
    }
    setIsSheetOpen(true);
  };

  const handleStartParty = async () => {
    if (!mapRef.current) return;
    setIsProcessingParty(true);

    const center = mapRef.current.getCenter();
    const result = await startPreParty({
      latitude: center.lat,
      longitude: center.lng,
      description: partyDescription,
      durationHours,
    });

    if (result.ok) {
      setPartyDescription("");
      setIsSheetOpen(false);
      loadMapData();
    } else {
      showFailure(result);
    }

    setIsProcessingParty(false);
  };

  const handleStopParty = async () => {
    setIsProcessingParty(true);
    const result = await stopPreParty();
    if (result.ok) {
      setIsSheetOpen(false);
    } else {
      showFailure(result);
    }
    loadMapData();
    setIsProcessingParty(false);
  };

  const handleRequestAccess = async (eventId: string) => {
    setLoadingActionId(eventId);
    const result = await requestEventAttendance(eventId);
    if (result.ok) loadMapData();
    else showFailure(result);
    setLoadingActionId(null);
  };

  const handleCancelRequest = async (eventId: string) => {
    setLoadingActionId(eventId);
    const result = await cancelEventRequest(eventId);
    if (!result.ok) showFailure(result);
    loadMapData();
    setLoadingActionId(null);
  };

  const handleRespondRequest = async (attendanceId: string, accept: boolean) => {
    setLoadingActionId(attendanceId);
    const result = await respondToEventRequest(attendanceId, accept);
    if (!result.ok) showFailure(result);
    loadMapData();
    setLoadingActionId(null);
  };

  const renderPartyPopup = (party: PrePartyEvent) => {
    const isHost = party.isHost;
    const acceptedAttendees = party.attendees.filter((a) => a.status === "ACCEPTED");
    const pendingAttendees = party.attendees.filter((a) => a.status === "PENDING");

    return (
      <div data-testid="preparty-popup" className="w-64 p-2 text-foreground font-sans flex flex-col">
        <div className="border-b border-border pb-2 mb-2">
          <span className="bg-secondary text-on-secondary text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full mb-1 inline-block">{t("partyLabel")}</span>
          <h3 className="font-black text-lg leading-tight mt-1 text-foreground">{t("hostLabel", { name: party.owner.name })}</h3>
          {party.owner.membersCount !== null && (
            <p className="text-xs font-bold text-muted-foreground mb-2">{t("membersCount", { count: party.owner.membersCount })}</p>
          )}
          {party.description && <p className="text-xs text-foreground/80 mb-2 line-clamp-3">{party.description}</p>}
          <div className="bg-muted text-[10px] font-bold text-muted-foreground px-2 py-1 rounded mb-1 flex items-center gap-1">
            {party.location.kind === "exact"
              ? party.location.label || t("exactLocation")
              : t("approxArea", { meters: party.location.radiusM })}
          </div>
        </div>

        {acceptedAttendees.length > 0 && (
          <div className="mb-2">
            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">{t("confirmedGuests")}</p>
            <div className="overflow-y-auto max-h-24 space-y-1.5 scrollbar-thin">
              {acceptedAttendees.map((att) => (
                <div key={att.id} className="flex items-center gap-2 p-1.5 bg-muted/50 rounded-xl border border-border">
                  <div className="w-6 h-6 rounded-full bg-muted overflow-hidden">
                    {att.group.photo && <img src={att.group.photo} alt={att.group.name} className="w-full h-full object-cover" />}
                  </div>
                  <div className="text-xs font-bold truncate flex-1 text-foreground">{att.group.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isHost && pendingAttendees.length > 0 && (
          <div className="mt-2 border-t border-border pt-2">
            <p className="text-[10px] font-bold uppercase text-secondary mb-1 animate-pulse">{t("pendingRequests", { count: pendingAttendees.length })}</p>
            <div className="overflow-y-auto max-h-28 space-y-1.5 scrollbar-thin">
              {pendingAttendees.map((req) => (
                <div key={req.id} className="flex items-center justify-between p-1.5 bg-secondary/10 rounded-xl border border-secondary/20">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <div className="w-6 h-6 rounded-full bg-muted overflow-hidden shrink-0">
                      {req.group.photo && <img src={req.group.photo} alt={req.group.name} className="w-full h-full object-cover" />}
                    </div>
                    <div className="text-xs font-bold truncate text-foreground">{req.group.name}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button data-testid="accept-request-btn" onClick={() => handleRespondRequest(req.id, true)} disabled={loadingActionId === req.id} aria-label={t("acceptRequest")} className="bg-green-600 hover:bg-green-500 text-white min-w-[36px] min-h-[36px] p-2 rounded-lg flex items-center justify-center cursor-pointer shadow-sm disabled:opacity-50"><Check size={14} strokeWidth={3} /></button>
                    <button data-testid="reject-request-btn" onClick={() => handleRespondRequest(req.id, false)} disabled={loadingActionId === req.id} aria-label={t("rejectRequest")} className="bg-destructive hover:opacity-90 text-on-destructive min-w-[36px] min-h-[36px] p-2 rounded-lg flex items-center justify-center cursor-pointer shadow-sm disabled:opacity-50"><X size={14} strokeWidth={3} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isHost && (
          <div className="mt-2 space-y-1.5">
            {party.myStatus === "ACCEPTED" ? (
              <button data-testid="open-event-chat-btn" onClick={() => party.chatId && router.push(`/${locale}/messages/${party.chatId}`)} disabled={!party.chatId} className="w-full bg-accent hover:opacity-90 text-on-accent text-xs font-black uppercase tracking-widest py-3 rounded-xl flex items-center justify-center gap-2 transition-transform active:scale-95 cursor-pointer min-h-[44px] disabled:opacity-50">
                <MessageCircle size={14} /> {t("chatInfo")}
              </button>
            ) : party.myStatus === "PENDING" ? (
              <>
                <div data-testid="request-pending" className="w-full bg-muted text-muted-foreground text-[10px] font-black uppercase tracking-widest py-3 rounded-xl flex items-center justify-center gap-1.5 border border-border min-h-[44px]">
                  <Clock size={14} /> {t("requestPending")}
                </div>
                <button data-testid="cancel-request-btn" onClick={() => handleCancelRequest(party.id)} disabled={loadingActionId === party.id} className="w-full text-muted-foreground hover:text-foreground text-[10px] font-bold uppercase tracking-widest py-2 rounded-full border border-border cursor-pointer min-h-[36px] disabled:opacity-50">
                  {t("cancelRequest")}
                </button>
              </>
            ) : party.myStatus === "REJECTED" ? (
              <div data-testid="request-rejected" className="w-full bg-muted text-muted-foreground text-[10px] font-black uppercase tracking-widest py-3 rounded-xl flex items-center justify-center gap-1.5 border border-border min-h-[44px]">
                <Ban size={14} /> {t("requestRejected")}
              </div>
            ) : (
              <button data-testid="request-access-btn" onClick={() => handleRequestAccess(party.id)} disabled={loadingActionId === party.id} className="w-full bg-secondary hover:opacity-90 text-on-secondary text-xs font-black uppercase tracking-widest py-3 rounded-xl flex items-center justify-center gap-1.5 transition-transform active:scale-95 shadow-md cursor-pointer min-h-[44px] disabled:opacity-50">
                {loadingActionId === party.id ? t("sending") : t("requestAccess")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-full bg-[#0a0a0a] relative">
      <MapContainer center={DEFAULT_CENTER} zoom={14} className="w-full h-full z-0" zoomControl={false} ref={mapRef} data-testid="map-container">
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='&copy; CARTO' />
        <MapCenterTracker onMoveEnd={handleMoveEnd} />

        <Marker position={userPosition} icon={createMarkerIcon("USER")} zIndexOffset={1000}>
          <Popup>
            <div className="p-1 text-foreground font-sans">
              <p className="font-black text-xs uppercase tracking-wider text-accent">
                {t("yourLocation")}
              </p>
              <h3 className="font-bold text-sm mt-0.5 capitalize text-foreground">
                {locationName}
              </h3>
            </div>
          </Popup>
        </Marker>

        {venues.map((venue) => (
          <Marker key={venue.id} position={[venue.latitude, venue.longitude]} icon={createMarkerIcon(venue.type as "BAR" | "CLUB")}>
            <Popup>
              <div data-testid="venue-popup" className="w-64 p-2 text-foreground font-sans flex flex-col max-h-72">
                <div className="border-b border-border pb-2 mb-2">
                  <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${venue.type === "CLUB" ? "bg-primary text-on-primary" : "bg-amber-500 text-black"}`}>{venue.type}</span>
                  <h3 className="font-black text-base mt-1 tracking-tight text-foreground">{venue.name}</h3>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5"><Users size={12} /><span data-testid="venue-attendee-count">{t("groupsAttending", { count: venue.attendeeCount })}</span></div>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pr-1 my-1 max-h-32 scrollbar-thin">
                  {venue.attendeeCount === 0 ? (
                    <p className="text-xs text-muted-foreground italic py-2 text-center">{t("noGroups")}</p>
                  ) : venue.attendees === null ? (
                    <p className="text-xs text-muted-foreground italic py-2 text-center">{t("guestNamesHidden")}</p>
                  ) : venue.attendees.map((group, index) => (
                    <div key={index} className="flex items-center gap-2 p-1.5 bg-muted/50 rounded-xl border border-border">
                      <div className="w-8 h-8 rounded-full bg-muted overflow-hidden relative flex-shrink-0">
                        {group.photo ? <img src={group.photo} alt={group.name} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-muted" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-foreground truncate">{group.name}</p>
                        <p className="text-[10px] text-muted-foreground">{t("membersCount", { count: group.membersCount })}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <button data-testid="venue-rsvp-btn" aria-pressed={venue.isMine} onClick={() => handleRsvpToggle(venue.id)} disabled={loadingActionId === venue.id} className="w-full mt-3 bg-accent text-on-accent text-xs font-black uppercase tracking-widest py-3 rounded-xl transition-all active:scale-95 hover:opacity-90 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 min-h-[44px]">
                  {loadingActionId === venue.id ? <span className="animate-pulse">{t("processing")}</span> : <><Check size={14} /> {t("toggleRsvp")}</>}
                </button>
              </div>
            </Popup>
          </Marker>
        ))}

        {preParties.map((party) =>
          party.location.kind === "exact" ? (
            <Marker key={party.id} position={[party.location.latitude, party.location.longitude]} icon={createMarkerIcon("PARTY")} zIndexOffset={500}>
              <Popup>{renderPartyPopup(party)}</Popup>
            </Marker>
          ) : (
            // S3: masked events are an area, never a pin at the (masked) center.
            <Circle
              key={party.id}
              center={party.location.center}
              radius={party.location.radiusM}
              pathOptions={{ className: "preparty-masked-circle", color: partyColor, fillColor: partyColor, fillOpacity: 0.2, weight: 2 }}
              eventHandlers={{ add: (event) => event.target.getElement()?.setAttribute("data-testid", "preparty-masked-circle") }}
            >
              <Popup>{renderPartyPopup(party)}</Popup>
            </Circle>
          ),
        )}
      </MapContainer>

      {errorKey && (
        <div className="absolute top-4 left-4 right-4 z-[1500] flex justify-center pointer-events-none">
          <div role="alert" data-testid="map-error" className="pointer-events-auto max-w-md w-full bg-card border border-destructive/40 text-foreground rounded-full pl-5 pr-2 py-2 shadow-2xl flex items-center gap-3">
            <p className="flex-1 text-xs font-bold">{tErr(errorKey)}</p>
            <button type="button" onClick={() => setErrorKey(null)} aria-label={t("dismissError")} className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer min-w-[36px] min-h-[36px] flex items-center justify-center">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="absolute bottom-24 right-4 z-[1000]">
        <button
          onClick={openPartySheet}
          data-testid="share-location-btn"
          className={`h-12 px-5 rounded-full flex items-center gap-2 transition-all duration-300 shadow-2xl font-sans text-xs font-black uppercase tracking-wider cursor-pointer ${myEvent
              ? "bg-secondary border border-white text-on-secondary animate-pulse"
              : "bg-card/90 backdrop-blur-md border border-primary text-primary hover:bg-card hover:scale-105 active:scale-95"
            }`}
        >
          {myEvent ? (
            <>
              <Clock size={16} />
              <span>{t("activeParty")}</span>
            </>
          ) : (
            <>
              <Flame size={16} strokeWidth={2.5} />
              <span>{t("createParty")}</span>
            </>
          )}
        </button>
      </div>

      {isSheetOpen && (
        <div className="absolute inset-0 z-[2000] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setIsSheetOpen(false)} />
          <div data-testid="preparty-sheet" className="relative bg-card border-t border-border rounded-t-3xl p-6 pb-10 animate-in slide-in-from-bottom shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black uppercase tracking-widest text-foreground flex items-center gap-2"><Flame className="text-secondary" /> {t("partyLabel")}</h2>
              <button onClick={() => setIsSheetOpen(false)} aria-label={t("closeSheet")} className="text-muted-foreground hover:text-foreground bg-muted p-1.5 rounded-full cursor-pointer"><X size={20} /></button>
            </div>

            {myEvent ? (
              <div className="space-y-6">
                <div className="bg-secondary/10 border border-secondary/20 p-4 rounded-2xl flex flex-col items-center">
                  <p className="text-xs uppercase font-bold text-secondary mb-1">{t("timeRemaining")}</p>
                  <p data-testid="party-time-left" className="text-4xl font-black text-foreground tabular-nums tracking-tighter">{timeLeft}</p>
                  <p className="text-[10px] text-muted-foreground mt-2 text-center">{t("privacyNoteMasked", { meters: MASK_RADIUS_METERS })}</p>
                </div>
                <button data-testid="end-party-btn" onClick={handleStopParty} disabled={isProcessingParty} className="w-full bg-destructive hover:opacity-90 text-on-destructive font-black py-4 rounded-full uppercase tracking-widest flex justify-center items-center gap-2 cursor-pointer min-h-[44px]">
                  {isProcessingParty ? t("processing") : t("endNow")}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">{t("moveMapHint")}</p>
                <div>
                  <label className="text-xs font-bold uppercase text-muted-foreground mb-1 block">{t("descriptionLabel")}</label>
                  <input type="text" data-testid="party-description-input" maxLength={280} value={partyDescription} onChange={(e) => setPartyDescription(e.target.value)} placeholder={t("descriptionPlaceholder")} className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/50" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase text-muted-foreground mb-2">{t("durationLabel")}</p>
                  <div role="radiogroup" aria-label={t("durationLabel")} className="flex flex-wrap gap-2">
                    {PREPARTY_DURATION_CHIPS.map((hours) => (
                      <button
                        key={hours}
                        type="button"
                        role="radio"
                        aria-checked={durationHours === hours}
                        data-testid={`duration-chip-${hours}`}
                        onClick={() => setDurationHours(hours)}
                        className={`px-4 py-2 min-h-[40px] rounded-full text-xs font-black uppercase tracking-wider border transition-all cursor-pointer ${durationHours === hours
                            ? "bg-secondary text-on-secondary border-secondary"
                            : "bg-background text-muted-foreground border-border hover:text-foreground"
                          }`}
                      >
                        {t("durationHours", { hours })}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bg-muted/50 p-3 rounded-xl border border-border flex items-start gap-3 mt-4">
                  <p className="text-xs text-muted-foreground leading-tight"><strong className="text-foreground">{t("privacySafeLabel")}</strong> {t("privacyBlurb", { meters: MASK_RADIUS_METERS })}</p>
                </div>
                <button data-testid="start-party-btn" onClick={handleStartParty} disabled={isProcessingParty} className="w-full bg-accent hover:opacity-90 text-on-accent font-black py-4 rounded-full uppercase tracking-widest mt-6 shadow-[0_0_20px_rgba(255,114,94,0.4)] active:scale-95 transition-all flex justify-center items-center cursor-pointer min-h-[48px]">
                  {isProcessingParty ? t("processing") : t("shareLocation")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {showGeoModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="geo-modal-title"
          aria-describedby="geo-modal-desc"
          className="fixed inset-0 z-[2500] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in"
        >
          <div
            data-testid="geo-error-modal"
            className="w-full max-w-md bg-card border border-border rounded-3xl p-6 shadow-2xl relative animate-in zoom-in-95 duration-200"
          >
            <button
              type="button"
              onClick={() => setShowGeoModal(false)}
              className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label={tGeo("close")}
            >
              <X size={20} />
            </button>

            <div className="w-14 h-14 rounded-2xl bg-destructive/10 text-destructive border border-destructive/20 flex items-center justify-center mb-4">
              <MapPinOff size={28} />
            </div>

            <h3 id="geo-modal-title" className="text-lg font-black uppercase tracking-wide text-foreground mb-2">
              {tGeo("title")}
            </h3>

            <p id="geo-modal-desc" className="text-sm text-foreground/80 leading-relaxed mb-4">
              {getGeoErrorMessage()}
            </p>

            <div className="bg-muted/50 border border-border rounded-xl p-3.5 mb-6">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <strong className="text-foreground block mb-1">{tGeo("troubleshootingTitle")}</strong>
                {tGeo("troubleshooting")}
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                data-testid="retry-geolocation-btn"
                onClick={requestLocation}
                disabled={isLocating}
                className="w-full bg-accent text-on-accent font-black py-3.5 rounded-xl uppercase tracking-wider text-xs flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all cursor-pointer min-h-[44px] disabled:opacity-50"
              >
                <RefreshCw size={15} className={isLocating ? "animate-spin" : ""} />
                <span>{isLocating ? t("processing") : tGeo("retry")}</span>
              </button>

              <button
                type="button"
                data-testid="dismiss-geolocation-btn"
                onClick={() => setShowGeoModal(false)}
                className="w-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition-all cursor-pointer min-h-[44px]"
              >
                {tGeo("dismiss")}
              </button>
            </div>
          </div>
        </div>
      )}
      {showPaywall && <GuestPaywall onClose={() => setShowPaywall(false)} />}
    </div>
  );
}
