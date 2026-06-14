"use client";

import { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import {
  getVenues, toggleVenueAttendance, getActiveEvents, getMyActiveEvent,
  startPreParty, stopPreParty, getMapSession, requestEventAttendance,
  respondToEventRequest, getOrCreateChatWithUser
} from "../actions/map";
import { Check, Users, Flame, X, Clock, MessageCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import GuestPaywall from "./GuestPaywall";

interface EventAttendance {
  id: string;
  status: string;
  groupId: string;
  group: AttendeeGroup;
}

interface GroupUser {
  name: string;
  username: string;
}

interface AttendeeGroup {
  id: string;
  membersCount: number;
  gender: string;
  photos: string[];
  user: GroupUser;
}

interface VenueAttendance {
  id: string;
  groupId: string;
  group: AttendeeGroup;
}

interface Venue {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  attendees: VenueAttendance[];
}

interface PrePartyEvent {
  id: string;
  title: string;
  description: string | null;
  locationName: string;
  latitude: number;
  longitude: number;
  endTime: string | Date;
  ownerId: string;
  attendees: EventAttendance[];
  owner: {
    name: string;
    group: {
      id: string;
      membersCount: number;
    } | null;
  };
}

export default function MapDisplay() {
  const t = useTranslations("Map");
  const locale = useLocale();
  const router = useRouter();
  const mapRef = useRef<L.Map | null>(null);
  const centerPosition: [number, number] = [49.9929, 8.2473]; // Mainz Central Coordinates

  const [showPaywall, setShowPaywall] = useState(false);
  const [userPosition, setUserPosition] = useState<[number, number]>(centerPosition);
  const [locationName, setLocationName] = useState<string>(t("mainzLocation"));
  const [session, setSession] = useState<{ userId: string, groupId: string | null } | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [preParties, setPreParties] = useState<PrePartyEvent[]>([]);
  const [myEvent, setMyEvent] = useState<PrePartyEvent | null>(null);
  const [loadingActionId, setLoadingActionId] = useState<string | null>(null);

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [partyDescription, setPartyDescription] = useState("");
  const [isProcessingParty, setIsProcessingParty] = useState(false);
  const [timeLeft, setTimeLeft] = useState<string>("");

  const [isGuest, setIsGuest] = useState(false);


  const loadMapData = async () => {
    if (isGuest) {
      setShowPaywall(true);
    }
    const sess = await getMapSession();
    setSession(sess);
    const venuesData = await getVenues();
    setVenues(venuesData as Venue[]);
    const partiesData = await getActiveEvents();
    setPreParties(partiesData as PrePartyEvent[]);
    const myActive = await getMyActiveEvent();
    setMyEvent(myActive as PrePartyEvent | null);
  };

  useEffect(() => {
    loadMapData();
  }, []);

  useEffect(() => {
    // We listen to ANY changes on the EventAttendance table.
    // When someone requests access (INSERT), gets accepted (UPDATE), or rejected (DELETE),
    // we trigger a silent background reload of the map data.
    const attendanceChannel = supabase
      .channel("map_event_attendance_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "EventAttendance" },
        () => {
          console.log("Realtime update: EventAttendance changed. Reloading map data...");
          loadMapData();
        }
      )
      .subscribe();

    // Also listen to new Events being created or deleted
    const eventChannel = supabase
      .channel("map_event_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "Event" },
        () => {
          console.log("Realtime update: Events changed. Reloading map data...");
          loadMapData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(attendanceChannel);
      supabase.removeChannel(eventChannel);
    };
  }, []);

  useEffect(() => {
    if (!myEvent) return;
    const interval = setInterval(() => {
      const diff = new Date(myEvent.endTime).getTime() - new Date().getTime();
      if (diff <= 0) {
        setTimeLeft("00:00:00");
        loadMapData();
      } else {
        const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        setTimeLeft(`${h}h ${m}m ${Math.floor((diff % (1000 * 60)) / 1000)}s`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [myEvent]);


  // Custom DivIcon generator to render clean Tailwind circles instead of default image flags
  const createMarkerIcon = (type: "BAR" | "CLUB" | "USER" | "PARTY") => {
    let colorClass = "bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.6)]";
    let extraClasses = "transition-all duration-300 transform hover:scale-125";

    if (type === "CLUB") {
      colorClass = "bg-[#FF725E] shadow-[0_0_15px_rgba(255,114,94,0.7)]";
    } else if (type === "BAR") {
      colorClass = "bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.7)]";
    } else if (type === "PARTY") {
      colorClass = "bg-pink-500 shadow-[0_0_20px_rgba(236,72,153,0.9)]";
      extraClasses += " animate-pulse";
    }

    return L.divIcon({
      className: "custom-leaflet-marker",
      html: `<div class="w-5 h-5 rounded-full border-2 border-black ${colorClass} transition-all duration-300 transform hover:scale-125"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  };

  useEffect(() => {
    if (typeof window !== "undefined" && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setUserPosition([lat, lng]);

          if (mapRef.current) {
            mapRef.current.flyTo([lat, lng], 14, { animate: true });
          }

          try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
            const data = await res.json();

            if (data && data.address) {
              const name = data.address.suburb || data.address.city || data.address.town || data.address.village || "Actual Location";
              setLocationName(name);
            }
          } catch (err) {
            console.error("Error translating location:", err);
          }
        },
        (error) => {
          console.error("Geolocation error:", error);
        },
        { enableHighAccuracy: true }
      );
    }
  }, []);

  const handleRsvpToggle = async (venueId: string) => {
    setLoadingActionId(venueId);
    const result = await toggleVenueAttendance(venueId);

    if (result && 'success' in result && result.success) {
      await loadMapData();
    } else if (result && 'error' in result && result.error) {

      const authErrors = ["Not authorized", "Group required", "Gruppe erforderlich", "Nicht autorisiert"];

      if (authErrors.includes(result.error)) {
        setShowPaywall(true);
      } else {
        console.error("RSVP error:", result.error);
        console.log("ERROR FROM SERVER:", result.error);
      }
    }
    setLoadingActionId(null);
  };

  const handleStartParty = async () => {
    if (!mapRef.current) return;
    setIsProcessingParty(true);

    const center = mapRef.current.getCenter();

    const result = await startPreParty(center.lat, center.lng, partyDescription);

    if (result && result.error) {
      const authErrors = ["Not authorized", "Group required", "Gruppe erforderlich", "Nicht autorisiert"];

      if (authErrors.includes(result.error)) {
        setShowPaywall(true);
      } else {
        console.error("Start party error:", result.error);
        console.log("ERROR FROM SERVER:", result.error);
      }
    } else {
      setPartyDescription("");
      setIsSheetOpen(false);
      await loadMapData();
    }

    setIsProcessingParty(false);
  };

  const handleStopParty = async () => {
    setIsProcessingParty(true);
    const result = await stopPreParty();
    if (!result.error) {
      setIsSheetOpen(false);
      await loadMapData();
    }
    setIsProcessingParty(false);
  };

  const handleRequestAccess = async (eventId: string) => {
    setLoadingActionId(eventId);
    const result = await requestEventAttendance(eventId);

    if (result && 'error' in result && result.error) {
      const authErrors = ["Not authorized", "Group required", "Gruppe erforderlich", "Nicht autorisiert"];

      if (authErrors.includes(result.error)) {
        setShowPaywall(true);
      } else {
        console.error("Request access error:", result.error);
        console.log("ERROR FROM SERVER:", result.error);
      }
    } else {
      await loadMapData();
    }

    setLoadingActionId(null);
  };

  const handleRespondRequest = async (attendanceId: string, accept: boolean) => {
    await respondToEventRequest(attendanceId, accept);
    await loadMapData();
  };

  const handleOpenChat = async (targetUserId: string) => {
    setIsProcessingParty(true);
    const result = await getOrCreateChatWithUser(targetUserId);

    if (result && result.error) {
      const authErrors = ["Not authorized", "Group required", "Gruppe erforderlich", "Nicht autorisiert"];

      if (authErrors.includes(result.error)) {
        setShowPaywall(true);
      } else {
        console.error("Open chat error:", result.error);
        console.log("ERROR FROM SERVER:", result.error);
      }
    } else if (result && result.success && result.chatId) {
      router.push(`/${locale}/messages/${result.chatId}`);
    }

    setIsProcessingParty(false);
  };

  return (
    <div className="w-full h-full bg-[#0a0a0a] relative">
      <MapContainer center={centerPosition} zoom={14} className="w-full h-full z-0" zoomControl={false} ref={mapRef}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='&copy; CARTO' />

        <Marker position={userPosition} icon={createMarkerIcon("USER")} zIndexOffset={1000}>
          <Popup>
            <div className="p-1 text-black font-sans">
              <p className="font-black text-xs uppercase tracking-wider text-blue-600">
                {t("yourLocation")}
              </p>
              <h3 className="font-bold text-sm mt-0.5 capitalize">
                {locationName}
              </h3>
            </div>
          </Popup>
        </Marker>

        {venues.map((venue) => {
          const totalGroups = venue.attendees?.length || 0;
          return (
            <Marker key={venue.id} position={[venue.latitude, venue.longitude]} icon={createMarkerIcon(venue.type as "BAR" | "CLUB")}>
              <Popup>
                <div className="w-64 p-2 text-black font-sans flex flex-col max-h-72">
                  <div className="border-b border-gray-100 pb-2 mb-2">
                    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full text-white ${venue.type === "CLUB" ? "bg-[#FF725E]" : "bg-amber-500"}`}>{venue.type}</span>
                    <h3 className="font-black text-base mt-1 tracking-tight text-gray-900">{venue.name}</h3>
                    <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5"><Users size={12} /><span>{t("groupsAttending", { count: totalGroups })}</span></div>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1 my-1 max-h-32 scrollbar-thin">
                    {totalGroups === 0 ? <p className="text-xs text-gray-400 italic py-2 text-center">{t("noGroups")}</p> : venue.attendees.map((attendance) => (
                      <div key={attendance.id} className="flex items-center gap-2 p-1.5 bg-gray-50 rounded-xl border border-gray-100">
                        <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden relative flex-shrink-0">
                          {attendance.group.photos?.[0] ? <img src={attendance.group.photos[0]} alt="Group" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gray-300" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-gray-800 truncate">{attendance.group.user?.name || "Group"}</p>
                          <p className="text-[10px] text-gray-500">{attendance.group.membersCount} members</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => handleRsvpToggle(venue.id)} disabled={loadingActionId === venue.id} className="w-full mt-3 bg-black text-white text-xs font-black uppercase tracking-widest py-2.5 rounded-xl transition-all active:scale-95 hover:bg-gray-900 flex items-center justify-center gap-1.5 disabled:opacity-50">
                    {loadingActionId === venue.id ? <span className="animate-pulse">{t("processing")}</span> : <><Check size={14} /> {t("toggleRsvp")}</>}
                  </button>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {preParties.map((party) => {

          const isHost = party.ownerId === session?.userId;
          const myAttendance = party.attendees?.find(a => a.groupId === session?.groupId);
          const isAccepted = myAttendance?.status === "ACCEPTED";
          const isPending = myAttendance?.status === "PENDING";

          const acceptedAttendees = party.attendees?.filter(a => a.status === "ACCEPTED") || [];
          const pendingAttendees = party.attendees?.filter(a => a.status === "PENDING") || [];

          return (
            <Marker key={party.id} position={[party.latitude, party.longitude]} icon={createMarkerIcon("PARTY")} zIndexOffset={500}>
              <Popup>
                <div className="w-64 p-2 text-black font-sans flex flex-col">
                  <div className="border-b border-gray-100 pb-2 mb-2">
                    <span className="bg-pink-500 text-white text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full mb-1 inline-block">{t("partyLabel")}</span>
                    <h3 className="font-black text-lg leading-tight mt-1">Host: {party.owner.name}</h3>
                    {party.owner.group && <p className="text-xs font-bold text-gray-600 mb-2">{party.owner.group.membersCount} members</p>}
                    <div className="bg-gray-100 text-[10px] font-bold text-gray-500 px-2 py-1 rounded mb-1 flex items-center gap-1">{party.locationName}</div>
                  </div>

                  {(isHost || isAccepted) && acceptedAttendees.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">{t("confirmedGuests")}</p>
                      <div className="overflow-y-auto max-h-24 space-y-1.5 scrollbar-thin">
                        {acceptedAttendees.map(att => (
                          <div key={att.id} className="flex items-center gap-2 p-1.5 bg-gray-50 rounded-xl border border-gray-100">
                            <div className="w-6 h-6 rounded-full bg-gray-200 overflow-hidden"><img src={att.group.photos?.[0]} className="w-full h-full object-cover" /></div>
                            <div className="text-xs font-bold truncate flex-1">{att.group.user.name}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {isHost && pendingAttendees.length > 0 && (
                    <div className="mt-2 border-t border-pink-100 pt-2">
                      <p className="text-[10px] font-bold uppercase text-pink-500 mb-1 animate-pulse">{t("pendingRequests")} ({pendingAttendees.length})</p>
                      <div className="overflow-y-auto max-h-28 space-y-1.5 scrollbar-thin">
                        {pendingAttendees.map(req => (
                          <div key={req.id} className="flex items-center justify-between p-1.5 bg-pink-50/50 rounded-xl border border-pink-100">
                            <div className="flex items-center gap-2 overflow-hidden">
                              <div className="w-6 h-6 rounded-full bg-gray-200 overflow-hidden shrink-0"><img src={req.group.photos?.[0]} className="w-full h-full object-cover" /></div>
                              <div className="text-xs font-bold truncate text-gray-800">{req.group.user.name}</div>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button onClick={() => handleRespondRequest(req.id, true)} className="bg-white p-1 rounded hover:bg-green-50 text-green-600 shadow-sm border border-gray-100"><Check size={14} strokeWidth={3} /></button>
                              <button onClick={() => handleRespondRequest(req.id, false)} className="bg-white p-1 rounded hover:bg-red-50 text-red-600 shadow-sm border border-gray-100"><X size={14} strokeWidth={3} /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!isHost && (
                    <div className="mt-2">
                      {isAccepted ? (
                        <button onClick={() => handleOpenChat(party.ownerId)} disabled={isProcessingParty} className="w-full bg-pink-500 hover:bg-pink-600 text-white text-xs font-black uppercase tracking-widest py-2.5 rounded-xl flex items-center justify-center gap-2 transition-transform active:scale-95">
                          {isProcessingParty ? t("opening") : <><MessageCircle size={14} /> {t("chatInfo")}</>}
                        </button>
                      ) : isPending ? (
                        <button disabled className="w-full bg-gray-200 text-gray-400 text-[10px] font-black uppercase tracking-widest py-2.5 rounded-xl flex items-center justify-center gap-1.5 border border-gray-300">
                          <Clock size={14} /> {t("requestPending")}
                        </button>
                      ) : (
                        <button onClick={() => handleRequestAccess(party.id)} disabled={loadingActionId === party.id} className="w-full bg-black hover:bg-gray-900 text-pink-400 text-xs font-black uppercase tracking-widest py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-transform active:scale-95 shadow-md">
                          {loadingActionId === party.id ? t("sending") : t("requestAccess")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      <div className="absolute bottom-20 right-4 z-[1000]">
        <button
          onClick={() => setIsSheetOpen(true)}
          className={`h-12 px-5 rounded-full flex items-center gap-2 transition-all duration-300 shadow-2xl font-sans text-xs font-black uppercase tracking-wider ${myEvent
              ? "bg-pink-500 border border-white text-white animate-pulse"
              : "bg-[#111] border border-[#FF725E] text-[#FF725E] hover:scale-105 active:scale-95"
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
          <div className="relative bg-[#111] border-t border-white/10 rounded-t-3xl p-6 pb-10 animate-in slide-in-from-bottom shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black uppercase tracking-widest text-white flex items-center gap-2"><Flame className="text-[#FF725E]" /> {t("partyLabel")}</h2>
              <button onClick={() => setIsSheetOpen(false)} className="text-gray-400 hover:text-white bg-white/5 p-1 rounded-full"><X size={20} /></button>
            </div>

            {myEvent ? (
              <div className="space-y-6">
                <div className="bg-pink-500/10 border border-pink-500/20 p-4 rounded-2xl flex flex-col items-center">
                  <p className="text-xs uppercase font-bold text-pink-500 mb-1">{t("timeRemaining")}</p>
                  <p className="text-4xl font-black text-white tabular-nums tracking-tighter">{timeLeft}</p>
                  <p className="text-[10px] text-gray-400 mt-2 text-center">{t("privacyNote")}</p>
                </div>
                <button onClick={handleStopParty} disabled={isProcessingParty} className="w-full bg-red-600 hover:bg-red-700 text-white font-black py-4 rounded-xl uppercase tracking-widest flex justify-center items-center gap-2">
                  {isProcessingParty ? t("processing") : t("stopParty")}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-400 leading-relaxed mb-4">Share your location to invite other groups to your pre-party. Move the map to the desired location before creating.</p>
                <div>
                  <label className="text-xs font-bold uppercase text-gray-500 mb-1 block">{t("descriptionLabel")}</label>
                  <input type="text" value={partyDescription} onChange={(e) => setPartyDescription(e.target.value)} placeholder={t("descriptionPlaceholder")} className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500 transition-colors placeholder:text-gray-700" />
                </div>
                <div className="bg-[#1a1a1a] p-3 rounded-xl border border-white/5 flex items-start gap-3 mt-4">
                  <p className="text-xs text-gray-400 leading-tight"><strong className="text-white">{t("privacySafeLabel")}</strong> We will mark the current center of your map, but your exact street/house number will be <span className="text-pink-400 font-bold">hidden</span> until you chat with a match.</p>
                </div>
                <button onClick={handleStartParty} disabled={isProcessingParty} className="w-full bg-pink-500 hover:bg-pink-600 text-white font-black py-4 rounded-xl uppercase tracking-widest mt-6 shadow-[0_0_20px_rgba(236,72,153,0.3)] active:scale-95 transition-all flex justify-center items-center">
                  {isProcessingParty ? t("processing") : t("shareLocation")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {showPaywall && <GuestPaywall onClose={() => setShowPaywall(false)} />}
    </div>
  );
}