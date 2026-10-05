import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { Loader2, MessageCircle } from 'lucide-react';
import { functions } from '../config/firebase';
import logo from '../assets/logo.png';

// Target of the "تواصل مع الفرع" button in the WhatsApp API templates
// (/contact/<record number>). Meta doesn't allow wa.me links in template
// buttons, so the button opens this page, which looks the record up (same
// public trackComplaint lookup as /track) and forwards the parent to the
// WhatsApp chat of the record's branch — or section, if it has its own
// number — with the record number pre-filled.
export default function ContactBranch() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [link, setLink] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await httpsCallable(functions, 'trackComplaint')({ complaintId: id || '' });
        if (!data.contactNumber) throw new Error('no number');
        const url = `https://wa.me/${data.contactNumber}?text=${encodeURIComponent(t('contactBranch.prefill', { id: data.complaintId }))}`;
        setLink(url);
        window.location.replace(url);
      } catch {
        setFailed(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
      <img src={logo} alt="" className="h-14 w-auto mb-6" />
      {failed ? (
        <p className="text-slate-600">{t('contactBranch.notFound')}</p>
      ) : link ? (
        <a href={link} className="px-5 py-3 bg-[#25D366] text-white rounded-xl font-medium flex items-center gap-2">
          <MessageCircle className="w-5 h-5" />
          {t('contactBranch.openChat')}
        </a>
      ) : (
        <p className="text-slate-600 flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" />{t('contactBranch.loading')}</p>
      )}
    </div>
  );
}
