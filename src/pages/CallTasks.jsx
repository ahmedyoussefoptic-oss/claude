import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PhoneOutgoing, ListChecks, Megaphone } from 'lucide-react';
import useAuthStore from '../stores/useAuthStore';
import { callRoleOf } from '../config/adminPermissions';
import MyCallTasks from '../components/callTasks/MyCallTasks';
import CallCampaigns from '../components/callTasks/CallCampaigns';
import PageHero from '../components/common/PageHero';

// «مهام الاتصال»: an agent's calls for today, and — for admins and call
// supervisors — the campaigns and their follow-up.
export default function CallTasks() {
  const { t } = useTranslation();
  const { userData } = useAuthStore();
  const isAgent = callRoleOf(userData, 'agent');
  const isSupervisor = callRoleOf(userData, 'supervisor');
  const [view, setView] = useState(isAgent && !(userData?.role === 'ADMIN' || userData?.isOwner) ? 'mine' : 'campaigns');
  const tabs = [isAgent && ['mine', ListChecks], isSupervisor && ['campaigns', Megaphone]].filter(Boolean);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <PageHero
        icon={PhoneOutgoing}
        title={t('callTasks.title')}
        subtitle={t('callTasks.subtitle')}
      />
      {tabs.length > 1 && (
        <div className="flex gap-1 bg-white rounded-xl border border-slate-100 shadow-sm p-1 w-fit">
          {tabs.map(([k, Icon]) => <button key={k} onClick={() => setView(k)} className={`px-4 py-2 rounded-lg text-sm flex items-center gap-1.5 ${view === k ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Icon className="w-4 h-4" />{t(`callTasks.tabs.${k}`)}</button>)}
        </div>
      )}
      {view === 'campaigns' && isSupervisor ? <CallCampaigns /> : <MyCallTasks />}
    </div>
  );
}
