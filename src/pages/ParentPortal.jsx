import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, CheckCircle2, Star, Send, MessageCircle } from 'lucide-react';
import { collection, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase';
import { format } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import logo from '../assets/logo.png';
import Watermark from '../components/common/Watermark';
import SystemCredit from '../components/common/SystemCredit';
import LanguageSwitcher from '../components/common/LanguageSwitcher';

// Each trackable record type: which collection its survey update targets
// (techSupport has none — that goes through the submitTechSupportSurvey
// callable instead, see handleSubmitSurvey), the status it must be in for
// the survey to show, and whether a "not satisfied" answer reopens it
// (doesn't make sense for a lost item already handed over, so lostFound
// skips straight to a rating-only form).
const TYPE_CONFIG = {
  complaint: { collection: 'complaints', surveyStatus: 'SOLVED', allowReopen: true },
  lostFound: { collection: 'lostFoundItems', surveyStatus: 'RETURNED', allowReopen: false },
  // Tech tickets close as soon as the resolution is sent (no waiting on the
  // parent), so the optional rating/reopen is offered on the closed ticket.
  techSupport: { collection: null, surveyStatus: 'CLOSED', allowReopen: true },
};

const RATING_KEYS = ['resolutionSpeed', 'solutionQuality', 'staffProfessionalism'];

export default function ParentPortal() {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'ar' ? ar : enUS;
  const getActionName = (action) => t(`parentPortal.actionNames.${action}`, action);
  const [searchParams] = useSearchParams();
  const [ticketId, setTicketId] = useState(searchParams.get('id') || '');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // A staff-generated link can pin the page's language via ?lang=ar|en.
  useEffect(() => {
    const lang = searchParams.get('lang');
    if (lang === 'ar' || lang === 'en') i18n.changeLanguage(lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Survey State
  const [ratings, setRatings] = useState({ resolutionSpeed: 0, solutionQuality: 0, staffProfessionalism: 0 });
  const [wantsReopen, setWantsReopen] = useState(null); // null | true | false
  const [surveyComment, setSurveyComment] = useState('');
  const [surveySubmitting, setSurveySubmitting] = useState(false);
  const [surveyDone, setSurveyDone] = useState(false);
  const [reopenDone, setReopenDone] = useState(false);

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!ticketId) return;

    setLoading(true);
    setError('');
    setResult(null);
    setSurveyDone(false);
    setReopenDone(false);
    setRatings({ resolutionSpeed: 0, solutionQuality: 0, staffProfessionalism: 0 });
    setWantsReopen(null);
    setSurveyComment('');

    try {
      // The lookup is by a human-readable tracking number, which Firestore
      // treats as a `list` query — something an anonymous visitor can't be
      // granted without exposing the whole collection. A Cloud Function does
      // the lookup server-side instead and returns only parent-safe fields.
      const trackComplaint = httpsCallable(functions, 'trackComplaint');
      const { data } = await trackComplaint({ complaintId: ticketId.trim() });

      setResult(data);
      if (data.rated || (data.status === 'CLOSED' && data.type !== 'techSupport')) {
        setSurveyDone(true);
      }
    } catch (err) {
      console.error(err);
      setError(err.code === 'functions/not-found' ? t('parentPortal.notFoundError') : t('parentPortal.systemError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (searchParams.get('id')) {
      handleSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const config = result ? TYPE_CONFIG[result.type] : null;

  const submitSurvey = async (e) => {
    e.preventDefault();

    if (config.allowReopen && wantsReopen === null) {
      alert(t('parentPortal.reopenChoiceRequiredAlert'));
      return;
    }
    if (wantsReopen !== true && Object.values(ratings).some((v) => v === 0)) {
      alert(t('parentPortal.allRatingsRequiredAlert'));
      return;
    }

    setSurveySubmitting(true);
    try {
      if (result.type === 'techSupport') {
        const submitTechSupportSurvey = httpsCallable(functions, 'submitTechSupportSurvey');
        await submitTechSupportSurvey({
          ticketId: result.complaintId,
          wantsReopen: !!wantsReopen,
          ratings: wantsReopen ? null : ratings,
          comment: surveyComment,
        });
      } else if (wantsReopen) {
        // Parent is not satisfied: reopen instead of closing.
        await updateDoc(doc(db, config.collection, result.id), {
          status: 'IN_PROGRESS',
          reopened: true,
          parentFeedback: surveyComment,
          updatedAt: serverTimestamp(),
        });
        await addDoc(collection(db, `${config.collection}/${result.id}/activityLog`), {
          action: 'COMPLAINT_REOPENED',
          actorId: 'PARENT',
          actorName: t('parentPortal.parentActor'),
          metadata: { reason: surveyComment },
          createdAt: serverTimestamp(),
        });
      } else {
        const satisfactionRate = Math.round(
          (ratings.resolutionSpeed + ratings.solutionQuality + ratings.staffProfessionalism) / 3
        );
        await updateDoc(doc(db, config.collection, result.id), {
          satisfactionRate,
          satisfactionDetails: ratings,
          parentFeedback: surveyComment,
          status: 'CLOSED',
          closedAt: serverTimestamp(),
        });
        await addDoc(collection(db, `${config.collection}/${result.id}/activityLog`), {
          action: 'SURVEY_SUBMITTED',
          actorId: 'PARENT',
          actorName: t('parentPortal.parentActor'),
          metadata: { rating: satisfactionRate, ...ratings },
          createdAt: serverTimestamp(),
        });
      }

      if (wantsReopen) {
        setReopenDone(true);
        setResult((prev) => ({ ...prev, status: result.type === 'techSupport' ? 'REOPENED' : 'IN_PROGRESS' }));
      } else {
        setSurveyDone(true);
        setResult((prev) => ({ ...prev, status: 'CLOSED' }));
      }
    } catch (err) {
      console.error(err);
      alert(t('parentPortal.surveySubmitError'));
    } finally {
      setSurveySubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col">
      <Watermark />
      {/* Public Header */}
      <header className="relative z-10 bg-white border-b border-slate-200 py-4 px-6 sticky top-0 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary">
            <img src={logo} alt={t('app.brand')} className="h-8 w-auto" />
            <span className="font-bold text-lg">{t('app.brand')}</span>
          </div>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center p-6 mt-10">

        <div className="w-full max-w-xl mb-10 text-center">
          <h1 className="text-3xl font-bold text-slate-900 mb-4">{t('parentPortal.pageTitle')}</h1>
          <p className="text-slate-500">{t('parentPortal.pageSubtitle')}</p>
        </div>

        {/* Search Box */}
        <div className="w-full max-w-xl bg-white p-6 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100">
          <form onSubmit={handleSearch}>
            <div className="relative flex items-center">
              <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-slate-400">
                <Search className="w-5 h-5" />
              </div>
              <input
                type="text"
                dir="ltr"
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
                placeholder="Ex: COM-2026-1234 / LF-2026-1234 / IT-2026-1234"
                className="block w-full pr-12 pl-32 py-4 border-2 border-slate-100 rounded-xl bg-slate-50 text-slate-900 focus:bg-white focus:border-primary focus:ring-0 transition-colors outline-none text-lg text-left tracking-widest font-mono uppercase"
              />
              <button
                type="submit"
                disabled={loading || !ticketId}
                className="absolute left-2 px-6 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-dark font-medium transition-colors disabled:opacity-70 flex items-center justify-center w-[110px]"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : t('parentPortal.searchBtn')}
              </button>
            </div>
          </form>

          {error && (
            <div className="mt-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100 text-center">
              {error}
            </div>
          )}
        </div>

        {/* Result Area */}
        {result && config && (
          <div className="w-full max-w-xl mt-8 animate-in slide-in-from-bottom-4 duration-500 space-y-6">

            {/* Ticket Info */}
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between pb-6 border-b border-slate-100 mb-6">
                <div>
                  <p className="text-sm text-slate-500 mb-1">{t(`parentPortal.typeConfig.${result.type}.label`)}</p>
                  <h2 className="text-xl font-bold text-slate-900 font-mono">#{result.complaintId}</h2>
                  {(result.studentName || result.itemName) && (
                    <p className="text-sm text-slate-500 mt-1">{result.studentName || result.itemName}</p>
                  )}
                  {result.contactNumber && (
                    <a
                      href={`https://wa.me/${result.contactNumber}?text=${encodeURIComponent(t('contactBranch.prefill', { id: result.complaintId }))}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 bg-[#25D366] text-white rounded-lg text-sm font-medium hover:brightness-95"
                    >
                      <MessageCircle className="w-4 h-4" />
                      {t('contactBranch.button')}
                    </a>
                  )}
                </div>
                <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-100 text-amber-800 border border-amber-200">
                  {t(`parentPortal.statusNames.${result.type}.${result.status}`, result.status)}
                </span>
              </div>

              <div className="space-y-6 relative before:absolute before:inset-y-0 before:right-[15px] before:w-[2px] before:bg-slate-100">
                {result.history.map((log, idx) => (
                  <div key={idx} className="relative flex gap-4">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 shadow-sm ring-4 ring-white bg-primary text-white">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div className="pt-1">
                      <p className="font-medium text-slate-900">{getActionName(log.action)}</p>
                      <p className="text-sm text-slate-400 mt-1" dir="ltr">
                        {log.createdAtMillis ? format(new Date(log.createdAtMillis), 'PP p', { locale: dateLocale }) : ''}
                      </p>
                      {log.metadata?.solutionDetails && (
                        <div className="mt-2 p-3 bg-emerald-50 text-emerald-800 rounded-lg text-sm border border-emerald-100">
                          <strong>{t('parentPortal.solutionDetailsLabel')}</strong> {log.metadata.solutionDetails}
                        </div>
                      )}
                      {log.metadata?.returnedTo && (
                        <div className="mt-2 p-3 bg-emerald-50 text-emerald-800 rounded-lg text-sm border border-emerald-100">
                          <strong>{t('parentPortal.returnedToLabel')}</strong> {log.metadata.returnedTo}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Satisfaction Survey */}
            {result.status === config.surveyStatus && !surveyDone && !reopenDone && (
              <div className="bg-white p-6 rounded-2xl border border-primary shadow-sm shadow-primary/10">
                <h3 className="text-lg font-bold text-slate-900 mb-2">{t('parentPortal.surveyTitle')}</h3>
                <p className="text-sm text-slate-500 mb-6">{t('parentPortal.surveySubtitle')}</p>

                {config.allowReopen && (
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <button
                      type="button"
                      onClick={() => setWantsReopen(false)}
                      className={`py-3 rounded-xl border text-sm font-medium transition-colors ${wantsReopen === false ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                    >
                      {t('parentPortal.satisfiedYes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setWantsReopen(true)}
                      className={`py-3 rounded-xl border text-sm font-medium transition-colors ${wantsReopen === true ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                    >
                      {t('parentPortal.satisfiedNo')}
                    </button>
                  </div>
                )}

                {(!config.allowReopen || wantsReopen !== null) && (
                  <form onSubmit={submitSurvey} className="space-y-4">
                    {wantsReopen === true ? (
                      <p className="text-sm text-slate-600 bg-red-50 border border-red-100 rounded-xl p-3">
                        {t('parentPortal.reopenNotice')}
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {RATING_KEYS.map((key) => (
                          <div key={key}>
                            <p className="text-sm font-medium text-slate-700 mb-1.5">{t(`ratings.${key}`)}</p>
                            <div className="flex items-center gap-1 justify-center">
                              {[1, 2, 3, 4, 5].map(star => (
                                <button
                                  key={star}
                                  type="button"
                                  onClick={() => setRatings(prev => ({ ...prev, [key]: star }))}
                                  className="focus:outline-none transition-transform hover:scale-110"
                                >
                                  <Star className={`w-7 h-7 ${star <= ratings[key] ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`} />
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <textarea
                      value={surveyComment}
                      onChange={(e) => setSurveyComment(e.target.value)}
                      placeholder={wantsReopen ? t('parentPortal.reopenReasonPlaceholder') : t('parentPortal.additionalCommentsPlaceholder')}
                      required={wantsReopen === true}
                      className="w-full border border-slate-200 rounded-xl p-4 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors outline-none text-sm resize-none"
                      rows={3}
                    />

                    <button
                      type="submit"
                      disabled={surveySubmitting}
                      className={`w-full py-3 text-white rounded-xl font-medium transition-colors disabled:opacity-70 flex items-center justify-center gap-2 ${wantsReopen ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary-dark'}`}
                    >
                      {surveySubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 -scale-x-100" />}
                      {wantsReopen ? t('parentPortal.reopenBtn') : t('parentPortal.submitRatingBtn')}
                    </button>
                  </form>
                )}
              </div>
            )}

            {surveyDone && (
              <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100 text-center">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="font-bold text-emerald-900 mb-1">{t('parentPortal.surveyDoneTitle')}</h3>
                <p className="text-sm text-emerald-700">{t('parentPortal.surveyDoneSubtitle')}</p>
              </div>
            )}

            {reopenDone && (
              <div className="bg-amber-50 p-6 rounded-2xl border border-amber-100 text-center">
                <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="font-bold text-amber-900 mb-1">{t('parentPortal.reopenDoneTitle')}</h3>
                <p className="text-sm text-amber-700">{t('parentPortal.reopenDoneSubtitle')}</p>
              </div>
            )}

          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="relative z-10 py-6 text-center text-slate-500 text-sm border-t border-slate-200 mt-auto bg-white">
        © {new Date().getFullYear()} {t('app.brand')}. {t('parentPortal.allRightsReserved')}
        <SystemCredit />
      </footer>
    </div>
  );
}
