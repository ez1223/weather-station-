
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Activity, 
  Thermometer, 
  Droplets, 
  Bell, 
  Settings, 
  RefreshCw, 
  AlertTriangle,
  Download,
  X,
  Save,
  Volume2,
  VolumeX,
  LogOut,
  CheckCircle2,
  BellOff,
  Monitor,
  Users as UsersIcon,
  Shield,
  UserPlus,
  History,
  Trash2,
  Search,
  Loader2,
  User as UserIcon,
  FileText,
  Eye,
  EyeOff,
  FileDown
} from 'lucide-react';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Area,
  AreaChart,
  ReferenceLine,
  Legend
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { ThingSpeakFeed, Alert, TimeRange, Thresholds, UserProfile, UserRole, AuditLog } from './types';
import { fetchLatestFeed, fetchHistory, exportToCSV } from './services/thingSpeakService';
import { REFRESH_INTERVAL, DEFAULT_THRESHOLDS, STORAGE_KEY_THRESHOLDS } from './constants';
import { supabase, adminActionClient } from './services/supabase';
import Auth from './Auth';

const STORAGE_KEY_SOUND = 'env_monitor_sound_enabled';
const STORAGE_KEY_NOTIFS = 'env_monitor_notifs_enabled';

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#0f1c1e]/90 backdrop-blur-md border border-[#1a2e31] p-3 rounded-xl shadow-2xl">
        <p className="text-[10px] font-bold text-gray-500 mb-2 uppercase tracking-widest">{label}</p>
        <div className="space-y-2">
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-xs text-gray-400 capitalize">{entry.name}</span>
              </div>
              <span className="text-xs font-bold text-white">
                {entry.value}{entry.name === 'temp' ? '°C' : '%'}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isProfileFetching, setIsProfileFetching] = useState(false);
  
  const [currentFeed, setCurrentFeed] = useState<ThingSpeakFeed | null>(null);
  const [history, setHistory] = useState<ThingSpeakFeed[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'error' | 'reconnecting'>('reconnecting');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  
  // Chart Display Toggles
  const [visibleSeries, setVisibleSeries] = useState({ temp: true, hum: true });
  
  // Modals & Tabs
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isUserManagementOpen, setIsUserManagementOpen] = useState(false);
  const [managementTab, setManagementTab] = useState<'users' | 'provision' | 'audit'>('users');
  
  // User Management State
  const [allProfiles, setAllProfiles] = useState<UserProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isProfilesLoading, setIsProfilesLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newUserData, setNewUserData] = useState({ email: '', password: '', role: 'viewer' as UserRole });
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [isSavingThresholds, setIsSavingThresholds] = useState(false);

  const activeBreaches = useRef<Set<string>>(new Set());

  const [thresholds, setThresholds] = useState<Thresholds>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_THRESHOLDS);
    return saved ? JSON.parse(saved) : DEFAULT_THRESHOLDS;
  });

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_SOUND);
    return saved === null ? true : saved === 'true';
  });

  const [notifsEnabled, setNotifsEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_NOTIFS);
    return saved === null ? true : saved === 'true';
  });

  const isAdmin = useMemo(() => userProfile?.role === 'admin', [userProfile]);

  const isTempAlert = useMemo(() => {
    if (!currentFeed) return false;
    const temp = parseFloat(currentFeed.field1);
    return !isNaN(temp) && (temp > thresholds.tempHigh || temp < thresholds.tempLow);
  }, [currentFeed, thresholds]);

  const isHumAlert = useMemo(() => {
    if (!currentFeed) return false;
    const hum = parseFloat(currentFeed.field2);
    return !isNaN(hum) && (hum > thresholds.humHigh || hum < thresholds.humLow);
  }, [currentFeed, thresholds]);

  // Auth & Profile Lifecycle
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchThresholds = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('thresholds')
        .select('*')
        .eq('id', 'global')
        .maybeSingle();

      if (data) {
        const remoteThresholds = {
          tempHigh: data.temp_high,
          tempLow: data.temp_low,
          humHigh: data.hum_high,
          humLow: data.hum_low
        };
        setThresholds(remoteThresholds);
        localStorage.setItem(STORAGE_KEY_THRESHOLDS, JSON.stringify(remoteThresholds));
      }
    } catch (err) {
      console.error('Error fetching thresholds:', err);
    }
  }, []);

  const fetchUserProfile = useCallback(async (userId: string, email: string) => {
    setIsProfileFetching(true);
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();

      if (profile) {
        setUserProfile({ id: userId, role: profile.role as UserRole, email });
      } else {
        const { count } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
        const role: UserRole = count === 0 ? 'admin' : 'viewer';
        
        const { data: newProfile } = await supabase
          .from('profiles')
          .upsert({ id: userId, role, email }, { onConflict: 'id' })
          .select()
          .single();
        
        if (newProfile) setUserProfile({ id: userId, role: newProfile.role as UserRole, email });
      }
    } catch (err) {
      console.error('Error syncing profile:', err);
      setUserProfile({ id: userId, role: 'viewer', email });
    } finally {
      setIsProfileFetching(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user?.id) {
      fetchUserProfile(session.user.id, session.user.email);
      fetchThresholds();
    } else {
      setUserProfile(null);
    }
  }, [session?.user?.id, fetchUserProfile, fetchThresholds]);

  // User Management Actions
  const loadAdminHubData = async () => {
    if (!isAdmin) return;
    setIsProfilesLoading(true);
    try {
      const [{ data: profiles }, { data: logs }] = await Promise.all([
        supabase.from('profiles').select('*'),
        supabase.from('audit_logs').select('*').order('timestamp', { ascending: false }).limit(30)
      ]);
      if (profiles) setAllProfiles(profiles);
      if (logs) setAuditLogs(logs);
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setIsProfilesLoading(false);
    }
  };

  useEffect(() => {
    if (isUserManagementOpen && isAdmin) loadAdminHubData();
  }, [isUserManagementOpen, isAdmin]);

  const logAudit = async (action: string) => {
    if (!session?.user) return;
    try {
      await supabase.from('audit_logs').insert({
        action,
        user_id: session.user.id,
        user_email: session.user.email,
        timestamp: new Date().toISOString()
      });
    } catch (err) {}
  };

  const updateUserRole = async (userId: string, newRole: UserRole) => {
    if (userId === session?.user?.id) return;
    try {
      const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
      if (error) throw error;
      setAllProfiles(prev => prev.map(p => p.id === userId ? { ...p, role: newRole } : p));
      logAudit(`Changed user role: ${userId} to ${newRole}`);
    } catch (err) {}
  };

  const revokeAccess = async (userId: string, email: string) => {
    if (userId === session?.user?.id) return;
    if (!confirm(`Confirm revocation of access for ${email}?`)) return;
    try {
      const { error } = await supabase.from('profiles').delete().eq('id', userId);
      if (error) throw error;
      setAllProfiles(prev => prev.filter(p => p.id !== userId));
      logAudit(`Revoked dashboard access for: ${email}`);
    } catch (err) {}
  };

  const handleProvisionUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setProvisionLoading(true);
    setProvisionError(null);
    try {
      const { data, error } = await adminActionClient.auth.signUp({
        email: newUserData.email,
        password: newUserData.password,
      });
      if (error) throw error;
      if (data.user) {
        await supabase.from('profiles').upsert({ id: data.user.id, email: newUserData.email, role: newUserData.role });
        logAudit(`Provisioned user: ${newUserData.email}`);
        setNewUserData({ email: '', password: '', role: 'viewer' });
        setManagementTab('users');
        loadAdminHubData();
      }
    } catch (err: any) {
      setProvisionError(err.message || 'Provisioning failed');
    } finally {
      setProvisionLoading(false);
    }
  };

  const saveThresholdsToDB = async () => {
    setIsSavingThresholds(true);
    try {
      const { error } = await supabase.from('thresholds').upsert({
        id: 'global',
        temp_high: thresholds.tempHigh,
        temp_low: thresholds.tempLow,
        hum_high: thresholds.humHigh,
        hum_low: thresholds.humLow,
        updated_at: new Date().toISOString()
      });

      if (error) throw error;

      localStorage.setItem(STORAGE_KEY_THRESHOLDS, JSON.stringify(thresholds));
      logAudit(`Updated environment thresholds: T(${thresholds.tempLow}-${thresholds.tempHigh}) H(${thresholds.humLow}-${thresholds.humHigh})`);
      setIsSettingsOpen(false);
    } catch (err: any) {
      console.error('Failed to save thresholds:', err);
      alert('Failed to sync thresholds to database. Local fallback applied.');
      localStorage.setItem(STORAGE_KEY_THRESHOLDS, JSON.stringify(thresholds));
      setIsSettingsOpen(false);
    } finally {
      setIsSavingThresholds(false);
    }
  };

  const updateData = useCallback(async () => {
    if (!session) return;
    try {
      setConnectionStatus('reconnecting');
      const [latestRes, historyRes] = await Promise.all([fetchLatestFeed(), fetchHistory(timeRange)]);
      
      if (latestRes.feeds && latestRes.feeds.length > 0) {
        const latest = latestRes.feeds[0];
        setCurrentFeed(latest);
        const temp = parseFloat(latest.field1);
        const hum = parseFloat(latest.field2);
        
        const check = (key: string, cond: boolean, title: string, desc: string, type: 'danger' | 'warning') => {
          if (cond && !activeBreaches.current.has(key)) {
            activeBreaches.current.add(key);
            setAlerts(prev => [{ id: `${Date.now()}`, type, title, description: desc, timestamp: new Date(), active: true, status: 'active', key }, ...prev].slice(0, 20));
            if (soundEnabled) {
              const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain); gain.connect(ctx.destination);
              osc.frequency.setValueAtTime(880, ctx.currentTime);
              gain.gain.setValueAtTime(0, ctx.currentTime);
              gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.05);
              gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
              osc.start(); osc.stop(ctx.currentTime + 0.3);
            }
            if (notifsEnabled && Notification.permission === 'granted') new Notification(title, { body: desc });
          } else if (!cond) { 
            activeBreaches.current.delete(key); 
          }
        };

        check('th', temp > thresholds.tempHigh, 'Temp High', `High breach: ${temp}°C`, 'danger');
        check('tl', temp < thresholds.tempLow, 'Temp Low', `Low breach: ${temp}°C`, 'warning');
        check('hh', hum > thresholds.humHigh, 'Hum High', `High humidity: ${hum}%`, 'danger');
        check('hl', hum < thresholds.humLow, 'Hum Low', `Low humidity: ${hum}%`, 'warning');
      }

      if (historyRes.feeds) setHistory(historyRes.feeds);
      setLastUpdate(new Date());
      setConnectionStatus('connected');
      setIsLoading(false);
    } catch (e) { 
      setConnectionStatus('error'); 
    }
  }, [timeRange, thresholds, session, soundEnabled, notifsEnabled]);

  useEffect(() => { if (session) updateData(); }, [updateData, session]);
  useEffect(() => {
    if (autoRefresh && session) {
      const id = setInterval(updateData, REFRESH_INTERVAL);
      return () => clearInterval(id);
    }
  }, [autoRefresh, updateData, session]);

  const filteredProfiles = useMemo(() => 
    allProfiles.filter(p => p.email?.toLowerCase().includes(searchQuery.toLowerCase())), 
  [allProfiles, searchQuery]);

  const chartData = useMemo(() => history.map(f => ({
    time: format(parseISO(f.created_at), 'HH:mm'),
    temp: parseFloat(f.field1),
    hum: parseFloat(f.field2)
  })), [history]);

  if (!session) return <Auth />;

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col gap-6 max-w-[1600px] mx-auto overflow-x-hidden">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-500/20 p-2 rounded-lg"><Activity className="text-emerald-500 w-6 h-6" /></div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">EnvMonitor <span className="text-emerald-500 font-light">Pro</span></h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-gray-600 font-medium truncate max-w-[200px]">{session?.user?.email}</span>
              {userProfile && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase ${isAdmin ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-blue-500/10 border-blue-500/20 text-blue-500'}`}>
                  {userProfile.role}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => updateData()} className="flex items-center gap-2 px-4 py-2 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-lg text-cyan-400 text-sm font-medium transition-colors">
            <RefreshCw className={`w-4 h-4 ${connectionStatus === 'reconnecting' ? 'animate-spin' : ''}`} />
            Sync: {Math.floor((new Date().getTime() - lastUpdate.getTime())/1000)}s ago
          </button>
          <div className="flex gap-2">
            <button onClick={() => Notification.requestPermission()} className="p-2 bg-card border border-card rounded-lg hover:border-emerald-500/50 transition-colors relative group">
              <Bell className="w-5 h-5 text-gray-400 group-hover:text-emerald-400" />
              {alerts.some(a => a.status !== 'acknowledged') && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>}
            </button>
            {isAdmin && (
              <button onClick={() => setIsUserManagementOpen(true)} className="p-2 bg-card border border-card rounded-lg hover:border-emerald-500/50 transition-colors group" title="Manage Users">
                <UsersIcon className="w-5 h-5 text-gray-400 group-hover:text-emerald-400" />
              </button>
            )}
            <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-card border border-card rounded-lg hover:border-emerald-500/50 transition-colors group" title="Thresholds">
              <Settings className="w-5 h-5 text-gray-400 group-hover:text-emerald-400" />
            </button>
            <button onClick={() => supabase.auth.signOut()} className="p-2 bg-card border border-card rounded-lg hover:border-red-500/50 transition-colors group">
              <LogOut className="w-5 h-5 text-gray-400 group-hover:text-red-400" />
            </button>
          </div>
        </div>
      </header>

      <main className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="md:col-span-3 flex flex-col gap-6">
          <div className={`bg-card border border-card rounded-2xl p-6 transition-all duration-300 ${isTempAlert ? 'pulse-red' : 'glow-temp'}`}>
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2 text-gray-400 uppercase text-xs font-bold tracking-wider"><Thermometer className="w-4 h-4 text-red-400" />Temperature</div>
              <div className={`px-2 py-0.5 border rounded text-xs font-semibold ${isTempAlert ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>{isTempAlert ? 'Alert' : 'Nominal'}</div>
            </div>
            <div className="flex items-baseline gap-1 mb-8"><span className="text-6xl font-bold text-white">{currentFeed?.field1 || '--'}</span><span className="text-3xl text-gray-400 font-medium">°C</span></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-black/20 rounded-xl border border-white/5"><p className="text-[10px] text-gray-500 font-bold mb-1">SAFE LOW</p><p className="text-lg font-semibold text-gray-300">{thresholds.tempLow}°</p></div>
              <div className="p-3 bg-black/20 rounded-xl border border-white/5"><p className="text-[10px] text-gray-500 font-bold mb-1">SAFE HIGH</p><p className="text-lg font-semibold text-red-400">{thresholds.tempHigh}°</p></div>
            </div>
          </div>
          <div className={`bg-card border border-card rounded-2xl p-6 transition-all duration-300 ${isHumAlert ? 'pulse-cyan' : 'glow-hum'}`}>
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2 text-gray-400 uppercase text-xs font-bold tracking-wider"><Droplets className="w-4 h-4 text-cyan-400" />Humidity</div>
              <div className={`px-2 py-0.5 border rounded text-xs font-semibold ${isHumAlert ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>{isHumAlert ? 'Breach' : 'Nominal'}</div>
            </div>
            <div className="flex items-baseline gap-1 mb-8"><span className="text-6xl font-bold text-white">{currentFeed?.field2 || '--'}</span><span className="text-3xl text-gray-400 font-medium">%</span></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-black/20 rounded-xl border border-white/5"><p className="text-[10px] text-gray-500 font-bold mb-1">SAFE LOW</p><p className="text-lg font-semibold text-gray-300">{thresholds.humLow}%</p></div>
              <div className="p-3 bg-black/20 rounded-xl border border-white/5"><p className="text-[10px] text-gray-500 font-bold mb-1">SAFE HIGH</p><p className="text-lg font-semibold text-cyan-400">{thresholds.humHigh}%</p></div>
            </div>
          </div>
        </div>

        <div className="md:col-span-6 flex flex-col gap-6">
          <div className="bg-card border border-card rounded-2xl p-6 flex-1 flex flex-col min-h-[500px]">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <div>
                <h3 className="font-semibold text-lg text-white">Station Telemetry</h3>
                <div className="flex gap-4 mt-2">
                  <button 
                    onClick={() => setVisibleSeries(v => ({...v, temp: !v.temp}))}
                    className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider transition-all ${visibleSeries.temp ? 'text-red-400' : 'text-gray-600 opacity-50'}`}
                  >
                    {visibleSeries.temp ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} Temperature
                  </button>
                  <button 
                    onClick={() => setVisibleSeries(v => ({...v, hum: !v.hum}))}
                    className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider transition-all ${visibleSeries.hum ? 'text-cyan-400' : 'text-gray-600 opacity-50'}`}
                  >
                    {visibleSeries.hum ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} Humidity
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => exportToCSV(history)} 
                  className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-gray-400 text-xs font-bold transition-all"
                  title="Download Chart Data"
                >
                  <FileDown className="w-4 h-4" /> Export Data
                </button>
                <div className="flex bg-black/40 p-1 rounded-lg">
                  {(['24h', '7d', '30d'] as TimeRange[]).map((r) => (
                    <button key={r} onClick={() => setTimeRange(r)} className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${timeRange === r ? 'bg-cyan-500 text-white' : 'text-gray-500 hover:text-gray-300'}`}>{r}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex-1 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gTemp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f87171" stopOpacity={0.4}/>
                      <stop offset="60%" stopColor="#f87171" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#f87171" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="gHum" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4}/>
                      <stop offset="60%" stopColor="#06b6d4" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff0a" />
                  <XAxis 
                    dataKey="time" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#4b5563', fontSize: 10}} 
                    minTickGap={40} 
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#4b5563', fontSize: 10}} 
                    domain={['auto', 'auto']}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  
                  {visibleSeries.temp && (
                    <>
                      <ReferenceLine y={thresholds.tempHigh} stroke="#f87171" strokeDasharray="5 5" strokeOpacity={0.3} label={{ position: 'right', value: 'High Temp', fill: '#f87171', fontSize: 8, fontWeight: 'bold' }} />
                      <ReferenceLine y={thresholds.tempLow} stroke="#f87171" strokeDasharray="5 5" strokeOpacity={0.3} label={{ position: 'right', value: 'Low Temp', fill: '#f87171', fontSize: 8, fontWeight: 'bold' }} />
                      <Area 
                        type="monotone" 
                        dataKey="temp" 
                        name="temp"
                        stroke="#f87171" 
                        strokeWidth={3} 
                        fill="url(#gTemp)" 
                        activeDot={{ r: 6, stroke: '#0f1c1e', strokeWidth: 2 }}
                        animationDuration={1000}
                      />
                    </>
                  )}
                  
                  {visibleSeries.hum && (
                    <>
                      <ReferenceLine y={thresholds.humHigh} stroke="#06b6d4" strokeDasharray="5 5" strokeOpacity={0.3} label={{ position: 'left', value: 'High Hum', fill: '#06b6d4', fontSize: 8, fontWeight: 'bold' }} />
                      <ReferenceLine y={thresholds.humLow} stroke="#06b6d4" strokeDasharray="5 5" strokeOpacity={0.3} label={{ position: 'left', value: 'Low Hum', fill: '#06b6d4', fontSize: 8, fontWeight: 'bold' }} />
                      <Area 
                        type="monotone" 
                        dataKey="hum" 
                        name="humidity"
                        stroke="#06b6d4" 
                        strokeWidth={3} 
                        fill="url(#gHum)" 
                        activeDot={{ r: 6, stroke: '#0f1c1e', strokeWidth: 2 }}
                        animationDuration={1000}
                      />
                    </>
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="md:col-span-3 flex flex-col gap-6">
          <div className="bg-card border border-card rounded-2xl p-6 flex-1 flex flex-col overflow-hidden max-h-[600px]">
            <h3 className="font-semibold text-lg text-white mb-4">Incident Log</h3>
            <div className="space-y-4 flex-1 overflow-y-auto pr-2 custom-scroll">
              {alerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-gray-600 opacity-20"><Bell className="w-12 h-12 mb-2" /><p className="text-sm">No incidents</p></div>
              ) : (
                alerts.map((alert) => (
                  <div key={alert.id} className={`flex gap-3 p-3 rounded-xl border-l-4 transition-all ${alert.status === 'acknowledged' ? 'bg-white/5 grayscale opacity-50 border-gray-600' : (alert.type === 'danger' ? 'bg-red-500/5 border-red-500' : 'bg-yellow-500/5 border-yellow-500')}`}>
                    <AlertTriangle className={`w-4 h-4 shrink-0 ${alert.status === 'acknowledged' ? 'text-gray-500' : (alert.type === 'danger' ? 'text-red-500' : 'text-yellow-500')}`} />
                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                        <h4 className="text-xs font-bold text-gray-200">{alert.title}</h4>
                        {alert.status !== 'acknowledged' && (
                          <button onClick={() => setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, status: 'acknowledged' } : a))} className="p-1 hover:bg-emerald-500/20 text-emerald-500 rounded">
                            <CheckCircle2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-500 mt-1">{alert.description}</p>
                      <p className="text-[9px] text-gray-600 mt-2">{format(alert.timestamp, 'HH:mm:ss')}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => exportToCSV(history)} className="mt-6 w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold text-gray-400 flex items-center justify-center gap-2 transition-all active:scale-95">
              <Download className="w-4 h-4" /> EXPORT REPORT
            </button>
          </div>
        </div>
      </main>

      {isUserManagementOpen && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0f1c1e] border border-[#1a2e31] w-full max-w-4xl rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="p-6 border-b border-[#1a2e31] flex justify-between items-center bg-black/20">
              <div className="flex items-center gap-3"><UsersIcon className="w-6 h-6 text-emerald-500" /><h2 className="text-xl font-bold text-white">Administrative Hub</h2></div>
              <button onClick={() => setIsUserManagementOpen(false)} className="p-2 hover:bg-white/5 rounded-full text-gray-400"><X className="w-6 h-6" /></button>
            </div>
            
            <div className="flex bg-black/10 border-b border-[#1a2e31]">
              <button onClick={() => setManagementTab('users')} className={`flex-1 py-4 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 ${managementTab === 'users' ? 'text-emerald-500 border-b-2 border-emerald-500 bg-emerald-500/5' : 'text-gray-500 hover:text-gray-300'}`}><UsersIcon className="w-4 h-4" /> Team Directory</button>
              <button onClick={() => setManagementTab('provision')} className={`flex-1 py-4 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 ${managementTab === 'provision' ? 'text-emerald-500 border-b-2 border-emerald-500 bg-emerald-500/5' : 'text-gray-500 hover:text-gray-300'}`}><UserPlus className="w-4 h-4" /> Provision Access</button>
              <button onClick={() => setManagementTab('audit')} className={`flex-1 py-4 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 ${managementTab === 'audit' ? 'text-emerald-500 border-b-2 border-emerald-500 bg-emerald-500/5' : 'text-gray-500 hover:text-gray-300'}`}><History className="w-4 h-4" /> Security Audit</button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 custom-scroll">
               {managementTab === 'users' ? (
                 <div className="space-y-6">
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                      <input type="text" placeholder="Filter by email..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl pl-12 pr-4 py-4 text-sm text-white focus:outline-none focus:border-emerald-500/50" />
                    </div>
                    
                    {isProfilesLoading ? (
                      <div className="flex flex-col items-center justify-center py-20 gap-3"><Loader2 className="w-8 h-8 text-emerald-500 animate-spin" /><p className="text-gray-500 text-sm">Syncing security records...</p></div>
                    ) : (
                      <div className="grid gap-3">
                        {filteredProfiles.map(p => (
                          <div key={p.id} className="bg-black/20 border border-white/5 p-4 rounded-2xl flex items-center justify-between group hover:border-emerald-500/30 transition-all">
                            <div className="flex items-center gap-4">
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${p.role === 'admin' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-blue-500/10 border-blue-500/20 text-blue-500'}`}>
                                {p.role === 'admin' ? <Shield className="w-5 h-5" /> : <UserIcon className="w-5 h-5" />}
                              </div>
                              <div>
                                <h4 className="text-sm font-bold text-gray-200">{p.email}</h4>
                                <p className="text-[10px] text-gray-600 font-mono">{p.id.slice(0, 12)}...</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
                                {(['admin', 'viewer'] as UserRole[]).map((r) => (
                                  <button key={r} onClick={() => updateUserRole(p.id, r)} disabled={p.id === session?.user?.id} className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${p.role === r ? 'bg-emerald-500 text-white' : 'text-gray-500 disabled:opacity-30'}`}>
                                    {r}
                                  </button>
                                ))}
                              </div>
                              {p.id !== session?.user?.id && (
                                <button onClick={() => revokeAccess(p.id, p.email || '')} className="p-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg border border-red-500/20 transition-all">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                 </div>
               ) : managementTab === 'provision' ? (
                 <div className="max-w-lg mx-auto py-4">
                    <h3 className="text-xl font-bold text-white mb-2">New Account Provisioning</h3>
                    <p className="text-gray-500 text-sm mb-8">Generated users will inherit basic viewing permissions by default. You can upgrade their role after creation.</p>
                    <form onSubmit={handleProvisionUser} className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Enterprise Email</label>
                        <input type="email" required value={newUserData.email} onChange={e => setNewUserData({...newUserData, email: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-white focus:outline-none focus:border-emerald-500/50" placeholder="user@organization.com" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Initial Credential</label>
                        <input type="password" required value={newUserData.password} onChange={e => setNewUserData({...newUserData, password: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-white focus:outline-none focus:border-emerald-500/50" placeholder="••••••••" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Access Tier</label>
                        <select value={newUserData.role} onChange={e => setNewUserData({...newUserData, role: e.target.value as UserRole})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-white focus:outline-none focus:border-emerald-500/50 appearance-none">
                          <option value="viewer">Dashboard Viewer</option>
                          <option value="admin">System Administrator</option>
                        </select>
                      </div>
                      {provisionError && <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-medium">{provisionError}</div>}
                      <button type="submit" disabled={provisionLoading} className="w-full py-5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-emerald-900/20">
                        {provisionLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><UserPlus className="w-5 h-5" /> VALIDATE & PROVISION</>}
                      </button>
                    </form>
                 </div>
               ) : (
                 <div className="space-y-3">
                   {auditLogs.length === 0 ? (
                     <div className="flex flex-col items-center justify-center py-20 text-gray-600 opacity-20"><History className="w-12 h-12 mb-2" /><p>No logs available</p></div>
                   ) : auditLogs.map(l => (
                     <div key={l.id} className="bg-black/20 border border-white/5 p-4 rounded-xl flex items-start gap-4 hover:bg-black/30 transition-colors">
                        <div className="bg-gray-800 p-2 rounded-lg shrink-0"><FileText className="w-4 h-4 text-gray-400" /></div>
                        <div className="flex-1">
                          <p className="text-sm text-gray-200 font-medium">{l.action}</p>
                          <div className="flex justify-between items-center mt-2">
                            <span className="text-[10px] text-emerald-500/70 font-bold uppercase">{l.user_email}</span>
                            <span className="text-[10px] text-gray-600">{format(parseISO(l.timestamp), 'MMM dd, HH:mm:ss')}</span>
                          </div>
                        </div>
                     </div>
                   ))}
                 </div>
               )}
            </div>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0f1c1e] border border-[#1a2e31] w-full max-w-md rounded-3xl overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-[#1a2e31] flex justify-between items-center bg-black/20">
              <div className="flex items-center gap-3"><Settings className="w-5 h-5 text-emerald-500" /><h2 className="text-xl font-bold text-white">Station Config</h2></div>
              <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-white/5 rounded-full text-gray-400"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-8 space-y-8">
              <section className="grid grid-cols-2 gap-4">
                <button onClick={() => {
                   const next = !soundEnabled;
                   setSoundEnabled(next);
                   localStorage.setItem(STORAGE_KEY_SOUND, next.toString());
                }} className={`p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all ${soundEnabled ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'bg-black/20 border-white/5 text-gray-500'}`}>
                  {soundEnabled ? <Volume2 /> : <VolumeX />} <span className="text-[10px] font-bold">ALARM AUDIO</span>
                </button>
                <button onClick={() => {
                   const next = !notifsEnabled;
                   setNotifsEnabled(next);
                   localStorage.setItem(STORAGE_KEY_NOTIFS, next.toString());
                }} className={`p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all ${notifsEnabled ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-500' : 'bg-black/20 border-white/5 text-gray-500'}`}>
                  {notifsEnabled ? <Monitor /> : <BellOff />} <span className="text-[10px] font-bold">PUSH ALERTS</span>
                </button>
              </section>
              <section className="space-y-4">
                 <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Temperature Trigger Bounds (°C)</h3>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1"><span className="text-[9px] text-gray-600 font-bold uppercase">Safe Low</span><input type="number" value={thresholds.tempLow} onChange={e => setThresholds({...thresholds, tempLow: Number(e.target.value)})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50" /></div>
                    <div className="space-y-1"><span className="text-[9px] text-gray-600 font-bold uppercase">Safe High</span><input type="number" value={thresholds.tempHigh} onChange={e => setThresholds({...thresholds, tempHigh: Number(e.target.value)})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-red-500/50" /></div>
                 </div>
              </section>
              <section className="space-y-4">
                 <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Humidity Trigger Bounds (%)</h3>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1"><span className="text-[9px] text-gray-600 font-bold uppercase">Safe Low</span><input type="number" value={thresholds.humLow} onChange={e => setThresholds({...thresholds, humLow: Number(e.target.value)})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50" /></div>
                    <div className="space-y-1"><span className="text-[9px] text-gray-600 font-bold uppercase">Safe High</span><input type="number" value={thresholds.humHigh} onChange={e => setThresholds({...thresholds, humHigh: Number(e.target.value)})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500/50" /></div>
                 </div>
              </section>
              <button 
                onClick={saveThresholdsToDB} 
                disabled={isSavingThresholds}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-95"
              >
                {isSavingThresholds ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-5 h-5" /> SAVE SETTINGS</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
