import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Search, 
  Filter, 
  Bell, 
  BarChart3, 
  MapPin, 
  Tag, 
  Calendar, 
  ExternalLink,
  RefreshCw,
  TrendingUp,
  Clock,
  ChevronDown,
  ChevronUp,
  Layers,
  Zap,
  AlertCircle,
  Sparkles,
  Info,
  BookOpen,
  CheckCircle2,
  Database
} from "lucide-react";

interface Tender {
  id: number;
  title: string;
  organization: string;
  category: string;
  region: string;
  deadline: string;
  budget: number | null;
  reference: string;
  published_at: string;
  url?: string | null;
  is_live?: boolean;
}

interface Stats {
  total_tenders: number;
  by_category: { category: string; count: number }[];
  by_region: { region: string; count: number }[];
  avg_budget: number;
  last_scrape: { scraped_at: string; new_tenders: number } | null;
}

type ViewMode = 'all' | 'urgent' | 'newest' | 'by_urgency' | 'guide' | 'settings';

export default function App() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filters, setFilters] = useState<{ categories: string[]; regions: string[] }>({ categories: [], regions: [] });
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedRegion, setSelectedRegion] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isScraping, setIsScraping] = useState(false);
  const [autoSync, setAutoSync] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [connectivity, setConnectivity] = useState<{ status: string; code?: number; error?: string } | null>(null);
  const [page, setPage] = useState(1);
  const [totalTenders, setTotalTenders] = useState(0);
  const pageSize = 20;

  const fetchConnectivity = async () => {
    try {
      const res = await fetch('/api/connectivity');
      const data = await res.json();
      setConnectivity(data);
    } catch (e) {
      console.error('Failed to fetch connectivity', e);
    }
  };

   const fetchData = async () => {
     try {
       setLoading(true);
       setError(null);
       const [tendersRes, statsRes, filtersRes] = await Promise.all([
         fetch(`/api/tenders?page=${page}&size=${pageSize}&search=${search}&category=${selectedCategory === 'All' ? '' : selectedCategory}&region=${selectedRegion === 'All' ? '' : selectedRegion}`),
         fetch('/api/stats'),
         fetch('/api/filters')
       ]);
       
       const tendersData = await tendersRes.json();
       const statsData = await statsRes.json();
       const filtersData = await filtersRes.json();

       if (tendersData?.error) {
         setError(tendersData.details || tendersData.error);
       }

       if (tendersData && Array.isArray(tendersData.items)) {
         setTenders(tendersData.items);
         setTotalTenders(tendersData.total || 0);
       }
       if (statsData && !statsData.error) {
         setStats(statsData);
       }
       if (filtersData && Array.isArray(filtersData.categories)) {
         setFilters(filtersData);
       }
     } catch (error) {
       console.error("Failed to fetch data", error);
       const errorMsg = error instanceof Error ? error.message : String(error);
       setError(errorMsg);
       
       // Auto-run diagnostic on failure
       try {
         const diagRes = await fetch('/api/db-check');
         const diagData = await diagRes.json();
         if (diagData.status === 'error') {
           setError(`Database Error: ${diagData.error}`);
         }
       } catch (diagErr) {
         console.error("Diagnostic failed", diagErr);
       }
     } finally {
       setLoading(false);
     }
   };

  useEffect(() => {
    setPage(1);
    fetchData();
  }, [search, selectedCategory, selectedRegion]);

  useEffect(() => {
    fetchData();
  }, [page]);

  useEffect(() => {
    fetchConnectivity();
    const connInterval = setInterval(fetchConnectivity, 60000);
    
    // Refresh stats every 30 seconds
    const statsInterval = setInterval(() => {
      fetch('/api/stats').then(res => res.json()).then(data => {
        if (data && !data.error) setStats(data);
      });
    }, 30000);

    return () => {
      clearInterval(connInterval);
      clearInterval(statsInterval);
    };
  }, []);

  const processedTenders = useMemo(() => {
    if (!Array.isArray(tenders)) return [];
    let result = [...tenders];

    if (viewMode === 'urgent') {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);

      result = result.filter(t => {
        const deadline = new Date(t.deadline);
        return deadline >= now && deadline <= tomorrow;
      });
    } else if (viewMode === 'newest') {
      result = result.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()).slice(0, 10);
    } else if (viewMode === 'by_urgency') {
      result = result.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
    }

    return result;
  }, [tenders, viewMode]);

  const handleTriggerScrape = async () => {
    setIsScraping(true);
    await fetch('/api/scrape/trigger', { method: 'POST' });
    setTimeout(() => {
      setIsScraping(false);
      fetchData();
    }, 2000);
  };

  useEffect(() => {
    if (!autoSync) return;
    
    const interval = setInterval(() => {
      console.log("🔄 Auto-syncing...");
      handleTriggerScrape();
    }, 15 * 60 * 1000); // Every 15 minutes

    return () => clearInterval(interval);
  }, [autoSync]);

  const formatCurrency = (amount: number | null) => {
    if (!amount) return "N/A";
    return new Intl.NumberFormat('fr-MA', { style: 'currency', currency: 'MAD', maximumFractionDigits: 0 }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const getUrgencyColor = (deadline: string) => {
    const days = (new Date(deadline).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);
    if (days < 7) return "text-red-600 bg-red-50";
    if (days < 30) return "text-orange-600 bg-orange-50";
    return "text-emerald-600 bg-emerald-50";
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#1A3A5C] rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
              <Layers className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight text-[#1A3A5C]">PMMP Tracker</h1>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Tender Intelligence</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden lg:flex bg-gray-100 p-1 rounded-lg gap-1">
              {(['all', 'urgent', 'newest', 'by_urgency', 'guide', 'settings'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    viewMode === mode 
                      ? 'bg-white text-[#1A3A5C] shadow-sm' 
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1).replace('_', ' ')}
                </button>
              ))}
            </div>
            <div className="w-px h-8 bg-gray-200 mx-2 hidden lg:block" />
            {connectivity && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-50 border border-gray-100">
                <div className={`w-2 h-2 rounded-full ${connectivity.status === 'online' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  Portal: {connectivity.status === 'online' ? 'Connecté' : 'Erreur'}
                </span>
              </div>
            )}
            <button 
              onClick={() => setAutoSync(!autoSync)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-full border text-sm font-medium transition-all duration-300 ${
                autoSync 
                  ? "bg-green-50 text-green-700 border-green-200" 
                  : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
              }`}
            >
              <Zap className={`w-4 h-4 ${autoSync ? "fill-green-500" : ""}`} />
              <span className="hidden sm:inline">{autoSync ? "Auto-Sync: ON" : "Auto-Sync: OFF"}</span>
            </button>
            <button 
              className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#1A3A5C]/20 text-[#1A3A5C] hover:bg-[#1A3A5C]/5 text-sm font-medium transition-all disabled:opacity-50"
              onClick={handleTriggerScrape}
              disabled={isScraping}
            >
              <RefreshCw className={`w-4 h-4 ${isScraping ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isScraping ? 'Scraping...' : 'Sync'}</span>
            </button>
            <button 
              className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#1A3A5C] text-white hover:bg-[#1A3A5C]/90 text-sm font-medium transition-all"
              onClick={() => setViewMode('settings')}
            >
              <Bell className="w-4 h-4" />
              <span className="hidden sm:inline">Alerts</span>
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="bg-red-600 text-white py-3 px-4 shadow-lg animate-in slide-in-from-top duration-300">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm font-medium">
                <span className="font-bold">Database Error:</span> {error}
                <span className="ml-2 opacity-80 hidden md:inline">Please check your Vercel environment variables.</span>
              </p>
            </div>
            <button 
              onClick={() => fetchData()}
              className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-bold transition-colors whitespace-nowrap"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {viewMode === 'guide' ? (
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="text-center space-y-4">
              <h2 className="text-4xl font-bold text-[#1A3A5C]">Guide d'utilisation</h2>
              <p className="text-gray-500 text-lg">Tout ce que vous devez savoir pour maîtriser PMMP Tracker</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h3 className="flex items-center gap-2 text-blue-600 font-bold text-lg mb-4">
                  <TrendingUp className="w-5 h-5" />
                  Tableau de bord
                </h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Visualisez les statistiques clés en temps réel : nombre total d'appels d'offres, budget moyen et dernières mises à jour.
                </p>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h3 className="flex items-center gap-2 text-emerald-600 font-bold text-lg mb-4">
                  <Zap className="w-5 h-5" />
                  Alertes Telegram
                </h3>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Recevez des notifications instantanées sur votre téléphone dès qu'un nouvel appel d'offres est publié.
                </p>
              </div>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 space-y-6">
              <h3 className="text-xl font-bold text-[#1A3A5C] flex items-center gap-2">
                <Info className="w-5 h-5" />
                Configuration Telegram
              </h3>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <span className="font-bold">1</span>
                  </div>
                  <div>
                    <h4 className="font-bold">Créer un Bot</h4>
                    <p className="text-sm text-gray-500">Parlez à @BotFather sur Telegram pour créer votre bot et obtenir un <b>Token</b>.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <span className="font-bold">2</span>
                  </div>
                  <div>
                    <h4 className="font-bold">Obtenir votre Chat ID</h4>
                    <p className="text-sm text-gray-500">Envoyez un message à votre bot, puis utilisez un bot comme @userinfobot pour trouver votre <b>Chat ID</b>.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <span className="font-bold">3</span>
                  </div>
                  <div>
                    <h4 className="font-bold">Activer les alertes</h4>
                    <p className="text-sm text-gray-500">Ajoutez ces informations dans les <b>Paramètres du Projet</b> (Menu en haut à droite).</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#1A3A5C] text-white p-8 rounded-2xl shadow-lg space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" />
                  État du système
                </h3>
                <button 
                  className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/20 text-white hover:bg-white/20 text-xs font-medium transition-all"
                  onClick={async () => {
                    const res = await fetch('/api/cleanup/trigger', { method: 'POST' });
                    const data = await res.json();
                    alert(`Nettoyage terminé : ${data.deleted} offres expirées supprimées.`);
                    fetchData();
                  }}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Nettoyer les expirées
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm opacity-90">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  Backend API: Opérationnel
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  Database: Firestore Connectée
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  Scheduler: Scraping actif (30m)
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  Notifications: Telegram Configuré
                </div>
              </div>
            </div>
          </div>
        ) : viewMode === 'settings' ? (
          <div className="max-w-2xl mx-auto space-y-8">
            <div className="text-center space-y-4">
              <h2 className="text-3xl font-bold text-[#1A3A5C]">Paramètres</h2>
              <p className="text-gray-500">Configurez vos intégrations et préférences</p>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b">
                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Diagnostic Base de Données</h3>
                  <p className="text-xs text-gray-400">Vérifiez la connexion à Firestore sur Vercel</p>
                </div>
              </div>

              <div className="space-y-4">
                <button 
                  onClick={async () => {
                    try {
                      const res = await fetch('/api/db-check');
                      const data = await res.json();
                      if (data.status === 'ok') {
                        alert(`✅ Connexion réussie !\nBase de données : ${data.databaseId}\nDonnées trouvées : ${data.lastScrapeExists ? 'Oui' : 'Non (Lancez un Sync)'}`);
                      } else {
                        alert(`❌ Erreur de connexion :\n${data.error}`);
                      }
                    } catch (e) {
                      alert("❌ Erreur lors de l'appel à l'API de diagnostic.");
                    }
                  }}
                  className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 transition-all shadow-lg shadow-purple-900/10 flex items-center justify-center gap-2"
                >
                  <Search className="w-4 h-4" />
                  Tester la connexion Firestore
                </button>
              </div>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Notifications Telegram</h3>
                  <p className="text-xs text-gray-400">Alertes en temps réel pour les nouveaux tenders</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl flex gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    Pour des raisons de sécurité, les clés API doivent être configurées dans les <b>Paramètres du Projet</b> (Menu en haut à droite de l'éditeur).
                  </p>
                </div>

                <button 
                  onClick={async () => {
                    const res = await fetch('/api/telegram/test', { method: 'POST' });
                    const data = await res.json();
                    if (data.success) {
                      alert("✅ Message de test envoyé ! Vérifiez votre Telegram.");
                    } else {
                      alert("❌ Erreur : " + data.error);
                    }
                  }}
                  className="w-full py-3 bg-[#1A3A5C] text-white rounded-xl font-bold text-sm hover:bg-[#1A3A5C]/90 transition-all shadow-lg shadow-blue-900/10 flex items-center justify-center gap-2"
                >
                  <Zap className="w-4 h-4" />
                  Tester la notification
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {[
                { label: "Active Tenders", value: stats?.total_tenders || 0, icon: TrendingUp, color: "blue", trend: "+12%" },
                { label: "Avg. Budget", value: formatCurrency(stats?.avg_budget || 0), icon: BarChart3, color: "purple" },
                { label: "Last Update", value: stats?.last_scrape ? new Date(stats.last_scrape.scraped_at).toLocaleTimeString() : 'Never', icon: Clock, color: "orange" },
                { label: "New Today", value: stats?.last_scrape?.new_tenders || 0, icon: Zap, color: "emerald" }
              ].map((stat, i) => (
                <div key={i} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 group relative overflow-hidden">
                  <div className="flex justify-between items-start mb-4">
                    <div className={`p-2 rounded-lg bg-${stat.color}-50 text-${stat.color}-600`}>
                      <stat.icon className="w-5 h-5" />
                    </div>
                    {stat.trend && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-700">{stat.trend}</span>}
                  </div>
                  <p className="text-sm font-medium text-gray-500 mb-1">{stat.label}</p>
                  <h3 className="text-2xl font-bold text-[#1A3A5C]">{stat.value}</h3>
                  <div className={`absolute bottom-0 left-0 h-1 w-full bg-${stat.color}-600 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left`} />
                </div>
              ))}
            </div>

            <div className="flex flex-col lg:flex-row gap-8">
              {/* Sidebar Filters */}
              <aside className="w-full lg:w-64 space-y-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-24">
                  <div className="flex items-center gap-2 mb-6">
                    <Filter className="w-4 h-4 text-[#1A3A5C]" />
                    <h4 className="font-bold text-sm uppercase tracking-wider">Filters</h4>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className="text-xs font-bold text-gray-500 uppercase mb-3 block">Search</label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input 
                          placeholder="Keywords..." 
                          className="w-full pl-9 pr-4 py-2 bg-gray-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-[#1A3A5C]/20 outline-none"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-gray-500 uppercase mb-3 block">Category</label>
                      <div className="space-y-1 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                        <button 
                          onClick={() => setSelectedCategory('All')}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${selectedCategory === 'All' ? 'bg-[#1A3A5C] text-white' : 'hover:bg-gray-100'}`}
                        >
                          All Categories
                        </button>
                        {filters.categories.map(cat => (
                          <button 
                            key={cat}
                            onClick={() => setSelectedCategory(cat)}
                            className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors truncate ${selectedCategory === cat ? 'bg-[#1A3A5C] text-white' : 'hover:bg-gray-100'}`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-gray-500 uppercase mb-3 block">Region</label>
                      <div className="space-y-1 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                        <button 
                          onClick={() => setSelectedRegion('All')}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${selectedRegion === 'All' ? 'bg-[#1A3A5C] text-white' : 'hover:bg-gray-100'}`}
                        >
                          All Regions
                        </button>
                        {filters.regions.map(reg => (
                          <button 
                            key={reg}
                            onClick={() => setSelectedRegion(reg)}
                            className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors truncate ${selectedRegion === reg ? 'bg-[#1A3A5C] text-white' : 'hover:bg-gray-100'}`}
                          >
                            {reg}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </aside>

              {/* Main Content */}
              <div className="flex-1 space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-bold text-[#1A3A5C]">
                      {viewMode === 'urgent' ? 'Urgent Opportunities' : 
                       viewMode === 'newest' ? 'Latest 10 Opportunities' : 
                       viewMode === 'by_urgency' ? 'Opportunities by Deadline' : 
                       'All Opportunities'}
                    </h2>
                    {viewMode === 'urgent' && (
                      <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold animate-pulse">Expiring Soon</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 font-medium">{totalTenders} results found</span>
                </div>

                <AnimatePresence mode="popLayout">
                  {loading ? (
                    <div className="space-y-4">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-32 bg-white rounded-2xl animate-pulse border border-gray-100" />
                      ))}
                    </div>
                  ) : processedTenders.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-2xl border border-dashed">
                      <Search className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                      <p className="text-gray-400">No tenders match your filters.</p>
                    </div>
                  ) : (
                    <motion.div 
                      key="tenders-list"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-4"
                    >
                      {processedTenders.map((tender) => (
                        <motion.div
                          key={tender.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          layout
                        >
                          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-all duration-300 group">
                            <div className="flex flex-col md:flex-row justify-between gap-6">
                              <div className="flex-1 space-y-3">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {tender.is_live ? (
                                    <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[9px] font-bold flex items-center gap-1">
                                      <Zap className="w-2.5 h-2.5" />
                                      LIVE
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[9px] font-bold flex items-center gap-1">
                                      <Info className="w-2.5 h-2.5" />
                                      DEMO
                                    </span>
                                  )}
                                  <span className="px-3 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold">
                                    {tender.category}
                                  </span>
                                  <span className="px-3 py-0.5 rounded-full bg-gray-50 text-gray-600 text-[10px] font-bold flex items-center gap-1">
                                    <MapPin className="w-3 h-3" />
                                    {tender.region}
                                  </span>
                                  <span className="text-[10px] font-mono text-gray-400 uppercase tracking-tighter">Ref: {tender.reference}</span>
                                </div>
                                
                                <h3 className="text-lg font-bold text-[#1A3A5C] group-hover:text-blue-600 transition-colors leading-snug">
                                  {tender.title}
                                </h3>
                                
                                <div className="flex items-center gap-4 text-sm text-gray-500">
                                  <span className="flex items-center gap-1.5 font-medium">
                                    <Tag className="w-4 h-4" />
                                    {tender.organization}
                                  </span>
                                </div>
                              </div>

                              <div className="flex flex-row md:flex-col justify-between items-end gap-4 min-w-[180px]">
                                <div className="text-right">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Estimated Budget</p>
                                  <p className="text-xl font-black text-[#1A3A5C]">{formatCurrency(tender.budget)}</p>
                                </div>
                                
                                <div className="flex items-center gap-2">
                                  <div className="text-right">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Deadline</p>
                                    <p className={`text-sm font-bold flex items-center gap-1 px-2 py-1 rounded-md ${getUrgencyColor(tender.deadline)}`}>
                                      <Calendar className="w-3.5 h-3.5" />
                                      {formatDate(tender.deadline)}
                                    </p>
                                  </div>
                                  <button 
                                    className="p-2 rounded-full hover:bg-blue-50 hover:text-blue-600 transition-colors"
                                    onClick={() => {
                                      if (tender.url) {
                                        window.open(tender.url, '_blank', 'noopener,noreferrer');
                                      } else {
                                        alert("Lien non disponible pour cette offre.");
                                      }
                                    }}
                                  >
                                    <ExternalLink className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))}

                      {totalTenders > pageSize && (
                        <div className="mt-8 flex justify-center gap-2">
                          <button 
                            disabled={page === 1}
                            onClick={() => setPage(p => p - 1)}
                            className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm disabled:opacity-50 hover:bg-gray-50 transition-colors"
                          >
                            Précédent
                          </button>
                          <span className="flex items-center px-4 text-sm font-medium text-gray-600">
                            Page {page} sur {Math.ceil(totalTenders / pageSize)}
                          </span>
                          <button 
                            disabled={page >= Math.ceil(totalTenders / pageSize)}
                            onClick={() => setPage(p => p + 1)}
                            className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm disabled:opacity-50 hover:bg-gray-50 transition-colors"
                          >
                            Suivant
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}



