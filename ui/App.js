import React, { useState, useCallback, useRef, useEffect } from 'react';

// --- Functional Mock Components (Explicit Implementations) ---

const Button = ({ children, onClick, disabled, className = '', variant = 'default', size = 'default', title = '', ...props }) => {
    const baseStyle = "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
    const variants = {
        default: "bg-blue-600 text-white hover:bg-blue-700",
        secondary: "bg-gray-200 text-gray-800 hover:bg-gray-300",
        ghost: "hover:bg-gray-100 hover:text-accent-foreground",
        destructive: "bg-red-600 text-white hover:bg-red-700",
        outline: "border border-gray-300 bg-white hover:bg-gray-100",
        link: "text-blue-600 underline-offset-4 hover:underline",
    };
     const sizes = {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
    };
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`${baseStyle} ${sizes[size]} ${variants[variant] || variants.default} ${className}`}
            title={title}
            {...props}
        >
            {children}
        </button>
     );
};

const Input = ({ className = '', type, ...props }) => (
    <input
        type={type}
        className={`flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
    />
);

const Card = ({ children, className = '', ...props }) => (
    <div className={`rounded-lg border border-gray-200 bg-white text-card-foreground shadow-sm ${className}`} {...props}>
        {children}
    </div>
);

const CardHeader = ({ children, className = '', ...props }) => (
    <div className={`flex flex-col space-y-1.5 p-6 ${className}`} {...props}>
        {children}
    </div>
);

const CardTitle = ({ children, className = '', as = 'h3', ...props }) => {
    const Tag = as;
    return (
        <Tag className={`text-lg font-semibold leading-none tracking-tight ${className}`} {...props}>
            {children}
        </Tag>
    );
};

const CardContent = ({ children, className = '', ...props }) => (
    <div className={`p-6 pt-0 ${className}`} {...props}>
        {children}
    </div>
);

// Simple ScrollArea mock - uses native browser scroll
const ScrollArea = ({ children, className = '', elRef, ...props }) => (
    <div ref={elRef} className={`relative overflow-auto border border-gray-200 rounded-md ${className}`} {...props}>
        <div className="p-4"> {/* Added padding inside */}
            {children}
        </div>
    </div>
);

const Select = ({ children, className = '', ...props }) => (
    <select
        className={`flex h-10 w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-background placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
    >
        {children}
    </select>
);

const Label = ({ children, className = '', htmlFor = undefined, ...props }) => ( // Added htmlFor
    <label htmlFor={htmlFor} className={`text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${className}`} {...props}>
        {children}
    </label>
);

const Textarea = ({ className = '', ...props }) => (
    <textarea
        className={`flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-background placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
    />
);


// --- Icons (Full SVG Definitions) ---
const Star = ({ size = 16, className = '', filled = false }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-star ${className}`}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> );
const List = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-list ${className}`}><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg> );
const BookMarked = ({ size = 16, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-book-marked ${className}`}><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20a2 2 0 0 1 2 2v16a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1Z"/><polyline points="10 2 10 10 13 7 16 10 16 2"/></svg> );
const Edit = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-edit ${className}`}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg> );
const Save = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-save ${className}`}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> );
const CalendarDays = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-calendar-days ${className}`}><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg> );
const Tag = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-tag ${className}`}><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.432 0l6.568-6.568a2.426 2.426 0 0 0 0-3.432l-8.704-8.704Z"/><path d="M6 9h.01"/></svg> );
const Text = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-text ${className}`}><path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18.1H3"/></svg> );
const Upload = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-upload ${className}`}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg> );
const MessageSquare = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-message-square ${className}`}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> );
const Bot = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-bot ${className}`}><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg> );
const User = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-user ${className}`}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> );
const Loader2 = ({ size = 24, className = '' }) => ( <svg xmlns="http.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-loader-2 animate-spin ${className}`}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> );
const History = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-history ${className}`}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg> );
const FileText = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-file-text ${className}`}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg> );
const PlusCircle = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-plus-circle ${className}`}><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="16"/><line x1="8" x2="16" y1="12" y2="12"/></svg> );
const X = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-x ${className}`}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> );
const ArrowLeft = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-arrow-left ${className}`}><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg> );
const UploadCloud = ({ size = 24, className = '' }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`lucide lucide-upload-cloud ${className}`}><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg> );


// --- Constants ---
const SESSION_TYPES = [
    "individual", "phone", "skills group", "family session",
    "family skills", "couples", "couples individual"
];
const THERAPY_TYPES = [
    "ACT", "DBT", "CBT", "ERP", "Mindfulness",
    "Couples ACT", "Couples DBT", "DBT Skills"
];

// --- Utility Functions ---
const getTodayDateString = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};
const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    try {
        return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    } catch (e) { return 'Invalid Date'; }
};

// --- Sample Data (Updated) ---
const SAMPLE_SESSIONS = [
  {
    id: 1, fileName: "sample_session_alpha.mp3", clientName: "John Doe", sessionName: "Alpha Intro Session", date: "2025-03-28", sessionType: "individual", therapy: "CBT",
    transcription: "Therapist: Welcome John. How are things? \nPatient: Things are simulated. I'm feeling quite static today. \nTherapist: Static? Tell me more about that. \nPatient: It's like... placeholder text. No real dynamic content happening. \nTherapist: I see. Let's explore that feeling of being placeholder text.",
    chats: [ { id: 1700000000001, timestamp: Date.now() - 86400000, messages: [ { id: 1, sender: 'ai', text: "Loaded session: Alpha Intro Session (2025-03-28). Ask me anything." }, { id: 2, sender: 'user', text: "Summarize the patient's main concern.", starred: false }, { id: 3, sender: 'ai', text: "The patient described feeling 'static', like 'placeholder text', indicating a lack of dynamic content or engagement in their experience." } ] } ]
  },
  {
    id: 2, fileName: "sample_session_beta.mp3", clientName: "Jane Smith", sessionName: "Beta Refactoring Discussion", date: "2025-03-29", sessionType: "phone", therapy: "DBT",
    transcription: "Therapist: Hi Jane. This is Beta session. Any updates? \nPatient: I tried the refactoring technique. It was complex. \nTherapist: Complex in what way? \nPatient: Managing state, passing props... it felt overwhelming. \nTherapist: It's common to feel overwhelmed by complexity. Let's break it down.",
    chats: [ { id: 1700000000002, timestamp: Date.now(), messages: [ { id: 1, sender: 'ai', text: "Loaded session: Beta Refactoring Discussion (2025-03-29). How can I help?" }, ] } ]
  }
];

// --- Components ---

// --- Upload Modal ---
function UploadModal({ isOpen, onClose, onStartTranscription, isTranscribing, transcriptionError }) {
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const [modalFile, setModalFile] = useState(null);
  const [clientNameInput, setClientNameInput] = useState('');
  const [sessionDate, setSessionDate] = useState(getTodayDateString());
  const [sessionNameInput, setSessionNameInput] = useState('');
  const [sessionTypeInput, setSessionTypeInput] = useState(SESSION_TYPES[0]);
  const [therapyInput, setTherapyInput] = useState(THERAPY_TYPES[0]);

  const resetModal = useCallback(() => {
      setModalFile(null);
      setClientNameInput('');
      setSessionDate(getTodayDateString());
      setSessionNameInput('');
      setSessionTypeInput(SESSION_TYPES[0]);
      setTherapyInput(THERAPY_TYPES[0]);
      setDragActive(false);
      if(fileInputRef.current) { fileInputRef.current.value = ''; }
  }, []);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isTranscribing) return;
    if (e.type === "dragenter" || e.type === "dragover") { setDragActive(true); }
    else if (e.type === "dragleave") { setDragActive(false); }
  };

  const handleFileSelection = (file) => {
      if (file && file.type === 'audio/mpeg') {
          setModalFile(file);
          setSessionNameInput(file.name.replace(/\.[^/.]+$/, ""));
      } else {
          setModalFile(null);
          alert('Invalid file type. Please upload an MP3 file.');
      }
      if(fileInputRef.current) { fileInputRef.current.value = ''; }
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (isTranscribing) return;
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) { handleFileSelection(e.dataTransfer.files[0]); }
  };

  const handleFileSelect = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) { handleFileSelection(e.target.files[0]); }
  };

  const handleUploadAreaClick = () => { if (!modalFile && !isTranscribing) { fileInputRef.current?.click(); } };

  const handleStartClick = () => {
      if (modalFile && clientNameInput.trim() && sessionNameInput.trim() && sessionDate && sessionTypeInput && therapyInput) {
          const metadata = { clientName: clientNameInput.trim(), sessionName: sessionNameInput.trim(), date: sessionDate, sessionType: sessionTypeInput, therapy: therapyInput };
          onStartTranscription(modalFile, metadata);
      } else { alert("Please select a file and fill in all session details (Client Name, Session Name, Date, Type, Therapy)."); }
  };

  const handleClose = useCallback(() => { if (!isTranscribing) { resetModal(); onClose(); } }, [isTranscribing, onClose, resetModal]);
  useEffect(() => { if (isOpen) { resetModal(); } }, [isOpen, resetModal]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4" onClick={handleClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 relative space-y-4" onClick={(e) => e.stopPropagation()} onDragEnter={handleDrag}>
        <Button variant="ghost" size="icon" className="absolute top-2 right-2 text-gray-500 hover:text-gray-800" onClick={handleClose} disabled={isTranscribing}> <X size={20} /> </Button>
        <h2 className="text-xl font-semibold mb-4 text-center">Upload New Session</h2>
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${isTranscribing ? 'cursor-not-allowed bg-gray-100' : 'cursor-pointer'} ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'} ${modalFile ? 'bg-green-50 border-green-500 hover:border-green-600' : 'bg-gray-50'}`}
          onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop} onClick={handleUploadAreaClick}
        >
          <input ref={fileInputRef} type="file" accept="audio/mpeg" className="hidden" onChange={handleFileSelect} disabled={!!modalFile || isTranscribing} />
          <UploadCloud className={`mx-auto h-10 w-10 mb-2 ${dragActive ? 'text-blue-600' : (modalFile ? 'text-green-600' : 'text-gray-400')}`} />
          <p className="text-sm text-gray-600">{isTranscribing ? "Processing..." : (modalFile ? `Selected: ${modalFile.name}` : (dragActive ? "Drop MP3 file here" : "Drag & drop MP3 file or click"))}</p>
           {modalFile && !isTranscribing && (<Button variant="link" size="sm" className="text-xs text-red-600 mt-1" onClick={(e) => { e.stopPropagation(); setModalFile(null); setSessionNameInput(''); }}>Change file</Button>)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div><Label htmlFor="clientNameModal" className="mb-1 block">Client Name</Label><Input id="clientNameModal" type="text" placeholder="Client's Full Name" value={clientNameInput} onChange={(e) => setClientNameInput(e.target.value)} disabled={isTranscribing} /></div>
             <div><Label htmlFor="sessionNameModal" className="mb-1 block">Session Name / Title</Label><Input id="sessionNameModal" type="text" placeholder="e.g., Weekly Check-in" value={sessionNameInput} onChange={(e) => setSessionNameInput(e.target.value)} disabled={isTranscribing} /></div>
             <div><Label htmlFor="sessionDateModal" className="mb-1 block">Date</Label><Input id="sessionDateModal" type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} disabled={isTranscribing} /></div>
             <div><Label htmlFor="sessionTypeModal" className="mb-1 block">Session Type</Label><Select id="sessionTypeModal" value={sessionTypeInput} onChange={(e) => setSessionTypeInput(e.target.value)} disabled={isTranscribing}>{SESSION_TYPES.map(type => ( <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option> ))}</Select></div>
             <div className="md:col-span-2"><Label htmlFor="therapyTypeModal" className="mb-1 block">Therapy Modality</Label><Select id="therapyTypeModal" value={therapyInput} onChange={(e) => setTherapyInput(e.target.value)} disabled={isTranscribing}>{THERAPY_TYPES.map(type => ( <option key={type} value={type}>{type}</option> ))}</Select></div>
        </div>
        <Button className="w-full" onClick={handleStartClick} disabled={!modalFile || !clientNameInput.trim() || !sessionNameInput.trim() || !sessionDate || !sessionTypeInput || !therapyInput || isTranscribing}>
            {isTranscribing ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Transcribing...</>) : ('Upload & Transcribe Session')}
        </Button>
        {transcriptionError && (<div className="mt-2 text-center text-red-600 text-sm">Error: {transcriptionError}</div>)}
      </div>
    </div>
  );
}

// --- Landing Page ---
function LandingPage({ pastSessions, navigateToSession, openUploadModal }) {
  return (
    <div className="w-full max-w-4xl mx-auto flex-grow flex flex-col">
       <Card className="flex-grow flex flex-col">
            <CardHeader className="flex-shrink-0">
                <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center"> <History className="mr-2 h-5 w-5 text-blue-600" /> Session History </div>
                    <Button variant="ghost" size="icon" onClick={openUploadModal} title="Upload New Session"> <PlusCircle className="h-6 w-6 text-blue-600"/> </Button>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 flex-grow overflow-hidden flex flex-col">
                {pastSessions.length === 0 ? ( <p className="text-center text-gray-500 py-4">No sessions found. Upload one to get started!</p> ) : (
                    <>
                        <p className="text-sm text-gray-500 mb-3 flex-shrink-0">Select a session to view its details and analysis.</p>
                        <div className="flex-grow overflow-hidden">
                            <ScrollArea className="h-full">
                                <ul className="space-y-1">
                                    {pastSessions.map((session) => (
                                        <li key={session.id}>
                                            <Button variant="ghost" onClick={() => navigateToSession(session.id)} className="w-full justify-between text-left h-auto py-2 px-3 text-gray-700 hover:bg-gray-100" title={`Load: ${session.sessionName || session.fileName}`}>
                                                <div className="flex items-center space-x-3 overflow-hidden">
                                                    <FileText className="h-5 w-5 flex-shrink-0 text-gray-500"/>
                                                    <div className="flex flex-col overflow-hidden">
                                                        <span className="font-medium truncate">{session.sessionName || session.fileName}</span>
                                                        <span className="text-xs text-gray-500 truncate">{session.clientName || 'No Client'} - <span className="capitalize">{session.sessionType}</span></span>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col items-end flex-shrink-0 ml-2 text-right">
                                                     <span className="text-xs font-medium text-gray-600">{session.therapy || 'N/A'}</span>
                                                     <span className="text-sm text-gray-500">{session.date}</span>
                                                </div>
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            </ScrollArea>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    </div>
  );
}

// --- Starred Message Templates Component ---
function StarredTemplates({ starredMessages, onSelectTemplate, onClose }) {
    if (!starredMessages || starredMessages.length === 0) {
        return (
            <div className="absolute bottom-full mb-2 w-72 max-h-60 overflow-y-auto right-0 bg-white border border-gray-300 rounded-md shadow-lg p-2 text-sm text-gray-500 text-center z-10">
                No starred messages yet.
                 <Button variant="ghost" size="sm" onClick={onClose} className="absolute top-0 right-0 text-xs p-1 h-auto">Close</Button>
            </div>
        );
    }
    return (
        <div className="absolute bottom-full mb-2 w-72 max-h-60 overflow-y-auto right-0 bg-white border border-gray-300 rounded-md shadow-lg z-10">
             <Button variant="ghost" size="sm" onClick={onClose} className="absolute top-1 right-1 text-xs p-1 h-auto">Close</Button>
             <ul className="space-y-1 p-1">
                {starredMessages.map(msg => (
                    <li key={msg.id}>
                        <button onClick={() => onSelectTemplate(msg.text)} className="block w-full text-left p-2 text-sm text-gray-700 hover:bg-gray-100 rounded whitespace-normal" title="Insert this template">
                            {msg.text}
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}


// --- Session View ---
function SessionView({
    sessionId, activeChatId, setActiveChatIdHandler, pastSessions, navigateBack,
    chatHandlers, onSaveMetadata, onSaveTranscript, onSaveChat, starredMessages, onStarMessage
}) {
  const session = pastSessions.find(s => s.id === sessionId);
  const chatScrollRef = useRef(null);

  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [editClientName, setEditClientName] = useState('');
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editType, setEditType] = useState('');
  const [editTherapy, setEditTherapy] = useState('');
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [editTranscriptContent, setEditTranscriptContent] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);

  // Effect to initialize metadata edit state
  useEffect(() => {
    if (session) {
      if (!isEditingMetadata || (isEditingMetadata && session.id !== sessionId)) {
        setEditClientName(session.clientName || '');
        setEditName(session.sessionName || '');
        setEditDate(session.date || '');
        setEditType(session.sessionType || '');
        setEditTherapy(session.therapy || '');
      }
    }
  }, [session, isEditingMetadata, sessionId]);

  // Effect to initialize transcript edit state
  useEffect(() => { if (session && !isEditingTranscript) { setEditTranscriptContent(session.transcription || ''); } }, [session, isEditingTranscript]);
  // Effect to scroll chat to bottom
  useEffect(() => { if (chatScrollRef.current) { const el = chatScrollRef.current.firstChild; if(el) el.scrollTop = el.scrollHeight; } }, [chatHandlers.chatMessages]);

  // Effect to load messages when activeChatId prop changes
  useEffect(() => {
    if (session && activeChatId) {
        const currentChat = session.chats?.find(c => c.id === activeChatId);
        chatHandlers.loadChatMessages(currentChat?.messages || []);
    } else if (session && !activeChatId && session.chats?.length > 0) {
        // If activeChatId became null but chats exist, default to latest
        const latestChat = [...session.chats].sort((a, b) => b.timestamp - a.timestamp)[0];
        setActiveChatIdHandler(latestChat.id); // Trigger App to set it, which re-runs this effect
    } else if (!session) {
        chatHandlers.loadChatMessages([]);
    }
  }, [session, activeChatId, chatHandlers.loadChatMessages, setActiveChatIdHandler]); // Added setActiveChatIdHandler dependency

  // Handlers for Metadata Edit
  const handleEditMetadataToggle = () => { setIsEditingMetadata(!isEditingMetadata); /* Reset fields if turning on */ };
  const handleCancelMetadataEdit = () => setIsEditingMetadata(false);
  const handleSaveMetadataEdit = () => {
    if (!editClientName.trim() || !editName.trim() || !editDate || !editType || !editTherapy) { alert("Please fill all metadata fields."); return; }
    onSaveMetadata(sessionId, { clientName: editClientName.trim(), sessionName: editName.trim(), date: editDate, sessionType: editType, therapy: editTherapy });
    setIsEditingMetadata(false);
  };

  // Handlers for Transcript Edit
  const handleEditTranscriptToggle = () => { setEditTranscriptContent(session?.transcription || ''); setIsEditingTranscript(!isEditingTranscript); };
  const handleCancelTranscriptEdit = () => setIsEditingTranscript(false);
  const handleSaveTranscriptEdit = () => { onSaveTranscript(sessionId, editTranscriptContent); setIsEditingTranscript(false); };

  // Handler for Chat History Selection
  const handleSelectChatHistory = (chatId) => { setActiveChatIdHandler(chatId); };
  // Handler for Template Selection
  const handleSelectTemplate = (text) => { chatHandlers.setCurrentQuery(prev => prev + text); setShowTemplates(false); };

  // Find the currently active chat object using the prop
  const activeChat = session?.chats?.find(c => c.id === activeChatId);

  if (!session) { return ( <div className="text-center text-red-500 p-10"><p>Session not found.</p><Button onClick={navigateBack} variant="link" className="mt-2">Go Back</Button></div> ); }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 flex-grow flex flex-col min-h-0">
        {/* Header: Back Button & Edit Metadata Controls */}
         <div className="flex-shrink-0 flex justify-between items-center">
            <Button onClick={navigateBack} variant="ghost" className="text-gray-600 hover:text-gray-900"> <ArrowLeft className="mr-2 h-4 w-4" /> Back </Button>
            {!isEditingMetadata ? ( <Button onClick={handleEditMetadataToggle} variant="outline" size="sm"> <Edit className="mr-2 h-4 w-4" /> Edit Details </Button> ) : ( <div className="space-x-2"><Button onClick={handleSaveMetadataEdit} variant="default" size="sm"> <Save className="mr-2 h-4 w-4" /> Save </Button><Button onClick={handleCancelMetadataEdit} variant="secondary" size="sm"> Cancel </Button></div> )}
        </div>

         {/* Session Metadata Display/Edit Card */}
         <Card className="flex-shrink-0">
             <CardHeader><CardTitle>Details: {isEditingMetadata ? <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Session Name" className="text-lg font-semibold leading-none tracking-tight h-9 inline-block w-auto ml-1"/> : (session.sessionName || session.fileName)}</CardTitle></CardHeader>
             <CardContent className="space-y-3 text-sm">
                 <div className="flex items-center space-x-2"><User className="h-4 w-4 text-gray-500 flex-shrink-0" /><Label htmlFor="clientNameEditView" className="sr-only">Client Name</Label>{isEditingMetadata ? ( <Input id="clientNameEditView" value={editClientName} onChange={(e) => setEditClientName(e.target.value)} placeholder="Client Name" className="text-sm h-8 flex-grow"/> ) : ( <span>Client: <span className="font-medium">{session.clientName || 'N/A'}</span></span> )}</div>
                 <div className="flex items-center space-x-2"><CalendarDays className="h-4 w-4 text-gray-500 flex-shrink-0" /><Label htmlFor="sessionDateEditView" className="sr-only">Date</Label>{isEditingMetadata ? ( <Input id="sessionDateEditView" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="text-sm h-8 flex-grow"/> ) : ( <span>Date: <span className="font-medium">{session.date}</span></span> )}</div>
                 <div className="flex items-center space-x-2"><Tag className="h-4 w-4 text-gray-500 flex-shrink-0" /><Label htmlFor="sessionTypeEditView" className="sr-only">Type</Label>{isEditingMetadata ? ( <Select id="sessionTypeEditView" value={editType} onChange={(e) => setEditType(e.target.value)} className="text-sm h-8 flex-grow">{SESSION_TYPES.map(type => ( <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option> ))}</Select> ) : ( <span className="capitalize">Type: <span className="font-medium">{session.sessionType}</span></span> )}</div>
                 <div className="flex items-center space-x-2"><BookMarked className="h-4 w-4 text-gray-500 flex-shrink-0" /><Label htmlFor="therapyEditView" className="sr-only">Therapy</Label>{isEditingMetadata ? ( <Select id="therapyEditView" value={editTherapy} onChange={(e) => setEditTherapy(e.target.value)} className="text-sm h-8 flex-grow">{THERAPY_TYPES.map(type => ( <option key={type} value={type}>{type}</option> ))}</Select> ) : ( <span>Therapy: <span className="font-medium">{session.therapy || 'N/A'}</span></span> )}</div>
                 {session.fileName && !isEditingMetadata && ( <div className="flex items-center space-x-2 text-xs text-gray-400 pt-1"><FileText className="h-3 w-3" /><span>Original file: {session.fileName}</span></div> )}
             </CardContent>
         </Card>

        {/* Transcription Display/Edit Card */}
        <Card className="flex-shrink-0">
            <CardHeader className="flex items-center justify-between">
                <CardTitle>Transcription</CardTitle>
                 {!isEditingTranscript ? ( <Button onClick={handleEditTranscriptToggle} variant="outline" size="sm"> <Edit className="mr-2 h-4 w-4" /> Edit Transcript </Button> ) : ( <div className="space-x-2"><Button onClick={handleSaveTranscriptEdit} variant="default" size="sm"> <Save className="mr-2 h-4 w-4" /> Save Transcript </Button><Button onClick={handleCancelTranscriptEdit} variant="secondary" size="sm"> Cancel </Button></div> )}
            </CardHeader>
            <CardContent>
                {isEditingTranscript ? ( <Textarea value={editTranscriptContent} onChange={(e) => setEditTranscriptContent(e.target.value)} rows={10} className="whitespace-pre-wrap text-sm text-gray-700 font-mono"/> ) : ( <ScrollArea className="h-40 md:h-56 whitespace-pre-wrap text-sm text-gray-700">{session.transcription || "No transcription available."}</ScrollArea> )}
             </CardContent>
        </Card>

        {/* Current Chat Interface Card */}
        <Card className="flex-grow flex flex-col min-h-0">
             <CardHeader className="flex-shrink-0 flex justify-between items-center"><CardTitle className="flex items-center"><MessageSquare className="mr-2 h-5 w-5 text-blue-600" />Chat Session {activeChat ? `(${formatTimestamp(activeChat.timestamp)})` : ''}</CardTitle></CardHeader>
             <CardContent className="flex-grow flex flex-col space-y-4 overflow-hidden min-h-0">
                 <ScrollArea elRef={chatScrollRef} className="flex-grow space-y-3 min-h-0">
                    {chatHandlers.chatMessages.map((msg) => (
                        <div key={msg.id} className={`flex items-start space-x-2 group ${msg.sender === 'user' ? 'justify-end' : ''}`}>
                            {msg.sender === 'ai' && <Bot className="h-5 w-5 text-blue-600 flex-shrink-0 mt-1" />}
                            <div className={`relative rounded-lg p-2 px-3 text-sm max-w-[85%] break-words ${msg.sender === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
                                {msg.text}
                                {msg.sender === 'user' && ( <Button variant="ghost" size="icon" className="absolute -left-8 top-0 h-6 w-6 p-1 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-yellow-500" title={msg.starred ? "Unstar message" : "Star message as template"} onClick={() => activeChatId && onStarMessage(activeChatId, msg.id, msg.text, !msg.starred)}> <Star size={14} filled={!!msg.starred} /> </Button> )}
                            </div>
                             {msg.sender === 'user' && <User className="h-5 w-5 text-gray-500 flex-shrink-0 mt-1" />}
                        </div>
                    ))}
                    {chatHandlers.isChatting && ( <div className="flex items-start space-x-2"><Bot className="h-5 w-5 text-blue-600 flex-shrink-0 mt-1" /><div className="rounded-lg p-2 px-3 text-sm bg-gray-200 text-gray-800 italic"><Loader2 className="inline mr-1 h-4 w-4 animate-spin" /> Thinking...</div></div> )}
                 </ScrollArea>
                <form onSubmit={(e) => chatHandlers.handleChatSubmit(e)} className="relative flex space-x-2 flex-shrink-0 pt-2">
                     <Button type="button" variant="outline" size="icon" className="h-10 w-10 flex-shrink-0" title="Show Starred Templates" onClick={() => setShowTemplates(prev => !prev)}> <Star size={18} /> </Button>
                     {showTemplates && ( <StarredTemplates starredMessages={starredMessages} onSelectTemplate={handleSelectTemplate} onClose={() => setShowTemplates(false)} /> )}
                    <Input type="text" placeholder="Ask about the session..." value={chatHandlers.currentQuery} onChange={(e) => chatHandlers.setCurrentQuery(e.target.value)} disabled={chatHandlers.isChatting} className="flex-grow" />
                    <Button type="submit" disabled={chatHandlers.isChatting || !chatHandlers.currentQuery.trim()}> Send </Button>
                </form>
                 {chatHandlers.chatError && <p className="text-sm text-red-600 text-center flex-shrink-0">{chatHandlers.chatError}</p>}
             </CardContent>
        </Card>

         {/* Chat History Card */}
         {session?.chats && Array.isArray(session.chats) && session.chats.length > 1 && (
             <Card className="flex-shrink-0">
                  <CardHeader><CardTitle className="flex items-center"><List className="mr-2 h-5 w-5 text-gray-600"/> Chat History</CardTitle></CardHeader>
                  <CardContent>
                      <ScrollArea className="max-h-32">
                          <ul className="space-y-1">
                              {[...session.chats].sort((a, b) => b.timestamp - a.timestamp).map((chat) => (
                                  <li key={chat.id}>
                                      <Button variant="ghost" onClick={() => handleSelectChatHistory(chat.id)} className={`w-full justify-start text-left h-auto py-1 px-2 text-sm ${chat.id === activeChatId ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-gray-700'}`} title={`View chat from ${formatTimestamp(chat.timestamp)}`} disabled={chat.id === activeChatId}> Chat from: {formatTimestamp(chat.timestamp)} </Button>
                                  </li>
                              ))}
                          </ul>
                      </ScrollArea>
                  </CardContent>
             </Card>
         )}
    </div>
  );
}


// --- Main Application Component ---
function App() {
  const [view, setView] = useState('landing');
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeChatId, setActiveChatId] = useState(null);
  const [pastSessions, setPastSessions] = useState(SAMPLE_SESSIONS);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState('');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [currentChatMessages, setCurrentChatMessages] = useState([]);
  const [currentQuery, setCurrentQuery] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [chatError, setChatError] = useState('');
  const [starredMessages, setStarredMessages] = useState([]);

  // --- Handlers ---
  const navigateBack = useCallback(() => { /* ... clear activeSessionId, activeChatId, view, chat state ... */ }, []);

  const updatedNavigateToSession = useCallback((sessionId) => {
        const session = pastSessions.find(s => s.id === sessionId);
        if (session) {
            setActiveSessionId(sessionId);
            let initialChatId = null;
            // Ensure chats is an array before accessing
            if (Array.isArray(session.chats) && session.chats.length > 0) {
                initialChatId = [...session.chats].sort((a, b) => b.timestamp - a.timestamp)[0].id;
            }
            setActiveChatId(initialChatId);
            setCurrentChatMessages([]);
            setCurrentQuery('');
            setChatError('');
            setIsChatting(false);
            setView('session');
        } else { /* ... handle error ... */ }
    }, [pastSessions]);

  const setActiveChatIdHandler = useCallback((chatId) => { setActiveChatId(chatId); }, []);

  const updateSessionMetadata = useCallback((sessionId, updatedMetadata) => {
      setPastSessions(prev => prev.map(s => s.id === sessionId ? { ...s, ...updatedMetadata } : s));
  }, []);

  const saveTranscript = useCallback((sessionId, newTranscript) => {
      setPastSessions(prev => prev.map(s => s.id === sessionId ? { ...s, transcription: newTranscript } : s));
  }, []);

  const saveChat = useCallback((sessionId, updatedChatSession, isNewChat = false) => {
        setPastSessions(prevSessions =>
            prevSessions.map(session => {
                if (session.id === sessionId) {
                    const currentChats = Array.isArray(session.chats) ? session.chats : []; // Ensure array
                    let updatedChats;
                    if (isNewChat) {
                        updatedChats = [...currentChats, updatedChatSession];
                    } else {
                        const chatExists = currentChats.some(c => c.id === updatedChatSession.id);
                        if (chatExists) {
                             updatedChats = currentChats.map(chat => chat.id === updatedChatSession.id ? updatedChatSession : chat );
                        } else {
                             console.warn("Attempted to save non-existent chat, adding instead:", updatedChatSession.id);
                             updatedChats = [...currentChats, updatedChatSession]; // Add if not found (safety)
                        }
                    }
                    return { ...session, chats: updatedChats };
                }
                return session;
            })
        );
    }, []);

  const handleStartTranscription = useCallback(async (file, metadata) => {
    setIsTranscribing(true); setTranscriptionError('');
    await new Promise(resolve => setTimeout(resolve, 100)); // Short delay to show loading
    const success = Math.random() > 0.1; // Simulate success/fail

    if (success) {
      const dummyTranscription = `Therapist: Newly transcribed for ${metadata.sessionName} (${metadata.date})...`;
      const newSessionId = Date.now();
      const initialChat = { id: Date.now() + 1, timestamp: Date.now(), messages: [{ id: Date.now() + 2, sender: 'ai', text: `Started chat for ${metadata.sessionName} (${metadata.date}).` }] };
      const newSession = { id: newSessionId, fileName: file.name, ...metadata, transcription: dummyTranscription, chats: [initialChat] };
      setPastSessions(prev => [newSession, ...prev]);
      setIsUploadModalOpen(false);
      updatedNavigateToSession(newSessionId);
    } else { setTranscriptionError('Transcription failed (simulated).'); }
    setIsTranscribing(false);
  }, [updatedNavigateToSession]);


  const handleChatSubmit = useCallback(async (event) => {
    event.preventDefault();
    const session = pastSessions.find(s => s.id === activeSessionId);
    const currentChat = session?.chats?.find(c => c.id === activeChatId);
    if (!currentQuery.trim() || isChatting || !session || !currentChat) { /* ... set error ... */ return; }

    const userMessageId = Date.now();
    const newUserMessage = { id: userMessageId, sender: 'user', text: currentQuery, starred: false };
    setCurrentChatMessages(prev => [...prev, newUserMessage]); // Update local display
    const queryForApi = currentQuery;
    setCurrentQuery(''); setIsChatting(true); setChatError('');

    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate AI delay

    const aiMessageId = Date.now() + 1;
    const aiResponseText = `AI response to: "${queryForApi}"`;
    const aiResponseMessage = { id: aiMessageId, sender: 'ai', text: aiResponseText };
    setCurrentChatMessages(prev => [...prev, aiResponseMessage]); // Update local display

    const finalMessagesForSave = [...(currentChat.messages || []), newUserMessage, aiResponseMessage]; // Ensure messages array exists
    const updatedChatSession = { ...currentChat, messages: finalMessagesForSave };
    saveChat(activeSessionId, updatedChatSession, false); // Save updated chat

    setIsChatting(false);
  }, [currentQuery, isChatting, activeSessionId, activeChatId, pastSessions, saveChat]);


   const handleStarMessage = useCallback((chatIdToUpdate, messageId, messageText, shouldStar) => {
        if (shouldStar) { setStarredMessages(prev => (!prev.some(msg => msg.text === messageText)) ? [...prev, { id: messageId, text: messageText }] : prev); }
        else { setStarredMessages(prev => prev.filter(msg => msg.id !== messageId)); }

        setPastSessions(prevSessions =>
            prevSessions.map(session => {
                if (session.id === activeSessionId) {
                    const updatedChats = (session.chats || []).map(chat => {
                        if (chat.id === chatIdToUpdate) {
                            const updatedMessages = (chat.messages || []).map(msg => msg.id === messageId ? { ...msg, starred: shouldStar } : msg );
                            return { ...chat, messages: updatedMessages };
                        } return chat;
                    }); return { ...session, chats: updatedChats };
                } return session;
            })
        );
         if(chatIdToUpdate === activeChatId) { setCurrentChatMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, starred: shouldStar } : msg )); }
    }, [activeSessionId, activeChatId]);


   const loadChatMessages = useCallback((messages) => { setCurrentChatMessages(messages || []); }, []);

   const chatHandlers = { chatMessages: currentChatMessages, loadChatMessages, currentQuery, isChatting, chatError, setCurrentQuery, handleChatSubmit };

  // --- Render Logic ---
  return (
    <div className="flex flex-col min-h-screen bg-gray-100 font-sans">
      <header className="p-4 md:p-6 flex-shrink-0"><h1 className="text-2xl md:text-3xl font-bold text-center text-gray-800"> Therapy Session Analyzer </h1></header>
      <main className="flex-grow flex flex-col p-4 md:px-8 md:pb-8 overflow-hidden">
        {view === 'landing' && ( <LandingPage pastSessions={pastSessions} navigateToSession={updatedNavigateToSession} openUploadModal={() => { setTranscriptionError(''); setIsUploadModalOpen(true); }} /> )}
        {view === 'session' && activeSessionId && ( <SessionView sessionId={activeSessionId} activeChatId={activeChatId} setActiveChatIdHandler={setActiveChatIdHandler} pastSessions={pastSessions} navigateBack={navigateBack} chatHandlers={chatHandlers} onSaveMetadata={updateSessionMetadata} onSaveTranscript={saveTranscript} onSaveChat={saveChat} starredMessages={starredMessages} onStarMessage={handleStarMessage} /> )}
      </main>
      <UploadModal isOpen={isUploadModalOpen} onClose={() => { if (!isTranscribing) { setIsUploadModalOpen(false); setTranscriptionError(''); } }} onStartTranscription={handleStartTranscription} isTranscribing={isTranscribing} transcriptionError={transcriptionError} />
    </div>
  );
}

export default App;
