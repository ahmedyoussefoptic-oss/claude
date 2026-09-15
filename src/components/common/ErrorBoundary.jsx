import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

// A render error anywhere below this boundary used to blank the entire app
// (no boundary existed at all, so React unmounted the whole tree on any
// uncaught exception — reported as "the page goes white with no data").
// This catches it, logs the real error to the console for diagnosis, and
// shows a recoverable card instead of a dead white screen. Callers wrapping
// a specific record's detail view should pass `key={record.id}` on this
// component (not just on its child) — changing the key remounts the
// boundary and clears its error state when a different record is opened.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught a render error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 text-center">
            <div className="w-14 h-14 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-1">حدث خطأ أثناء عرض هذا السجل</h2>
            <p className="text-sm text-slate-500 mb-4">Something went wrong while rendering this record. Please share the message below with support.</p>
            <p className="text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-lg p-3 mb-4 font-mono text-left break-words" dir="ltr">
              {this.state.error?.message || String(this.state.error)}
            </p>
            <button
              onClick={this.props.onClose || (() => window.location.reload())}
              className="w-full px-4 py-2.5 text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 font-medium text-sm transition-colors"
            >
              {this.props.onClose ? 'إغلاق / Close' : 'إعادة التحميل / Reload'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
