import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Minus,
  Search,
  Upload,
} from 'lucide-react';
import './Dashboard.css';
import { apiFetch } from '../utils/apiClient';

function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    workspaces: 0,
    documents: 0,
    recentItems: 0,
    openTasks: 0,
    overdueTasks: 0,
  });
  const [user, setUser] = useState({
    username: '',
    email: '',
    joinedDate: '',
    status: '',
  });
  const [recentActivity, setRecentActivity] = useState([]);
  const [issues, setIssues] = useState([]);
  const [deadlines, setDeadlines] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  });
  const [selectedDay, setSelectedDay] = useState(() => new Date().getDate());
  const [activityFilter, setActivityFilter] = useState('all');

  const monthIndexMap = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };

  const currentMonthInfo = useMemo(() => {
    const [monthName, yearValue] = currentMonth.split(' ');
    const monthIndex = monthIndexMap[monthName] ?? 0;
    const year = Number.parseInt(yearValue, 10) || new Date().getFullYear();
    return { monthIndex, year };
  }, [currentMonth]);

  const fetchDashboardData = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const statsData = await apiFetch('/api/v1/dashboard/stats');
      setStats({
        workspaces: statsData.workspaces,
        documents: statsData.documents,
        recentItems: statsData.recent_items,
        openTasks: 0,
        overdueTasks: 0,
      });
      setUser({
        username: statsData.username,
        email: statsData.email,
        joinedDate: statsData.member_since,
        status: statsData.status_message || '',
      });

      const activityData = await apiFetch('/api/v1/dashboard/activity?limit=8');
      setRecentActivity(activityData.items || []);

      const issuesData = await apiFetch('/api/v1/dashboard/issues');
      const issueItems = issuesData.items || [];
      setIssues(issueItems);
      setStats((prev) => ({
        ...prev,
        openTasks: issueItems.length,
      }));

      const deadlinesData = await apiFetch('/api/v1/dashboard/deadlines');
      const deadlineItems = deadlinesData.items || [];
      const overdueCount = deadlineItems.filter((deadline) => deadline?.is_overdue).length;
      setDeadlines(deadlineItems);
      setStats((prev) => ({
        ...prev,
        overdueTasks: overdueCount,
      }));
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    const handleRealtimeRefresh = () => {
      fetchDashboardData();
    };

    window.addEventListener('workspaces-updated', handleRealtimeRefresh);
    window.addEventListener('containers-updated', handleRealtimeRefresh);
    window.addEventListener('documents-updated', handleRealtimeRefresh);
    window.addEventListener('client-search-logged', handleRealtimeRefresh);

    return () => {
      window.removeEventListener('workspaces-updated', handleRealtimeRefresh);
      window.removeEventListener('containers-updated', handleRealtimeRefresh);
      window.removeEventListener('documents-updated', handleRealtimeRefresh);
      window.removeEventListener('client-search-logged', handleRealtimeRefresh);
    };
  }, [fetchDashboardData]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const fetchFilteredActivity = async () => {
      try {
        const filterParam = activityFilter === 'all' ? '' : `&filter_type=${activityFilter}`;
        const data = await apiFetch(`/api/v1/dashboard/activity?limit=8${filterParam}`);
        setRecentActivity(data.items || []);
      } catch (err) {
        console.error('Error fetching filtered activity:', err);
      }
    };

    fetchFilteredActivity();
  }, [activityFilter]);

  const shiftMonth = (direction) => {
    const [monthName, yearValue] = currentMonth.split(' ');
    const monthIndex = monthIndexMap[monthName] ?? 0;
    const year = Number.parseInt(yearValue, 10) || new Date().getFullYear();
    const nextDate = new Date(year, monthIndex + direction, 1);
    setCurrentMonth(nextDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
    setSelectedDay(1);
  };

  const isAuthAction = (activity) => {
    if (!activity) return false;

    const rawType = String(activity.action_type || '').toLowerCase();
    const rawAction = String(activity.action || '').toLowerCase();
    const combined = `${rawType} ${rawAction}`;

    return (
      rawType.startsWith('user.')
      || combined.includes('login')
      || combined.includes('logout')
      || combined.includes('logged in')
      || combined.includes('logged out')
      || combined.includes('sign in')
      || combined.includes('sign out')
      || combined.includes('auth.')
      || combined.includes('authentication')
    );
  };

  const accomplishments = useMemo(() => {
    const accomplishmentActions = new Set([
      'document.uploaded',
      'document.downloaded',
      'workspace.created',
      'workspace.updated',
      'workspace.member_added',
      'workspace.member_updated',
      'workspace.member_removed',
    ]);

    return recentActivity.filter((activity) => {
      if (isAuthAction(activity)) return false;
      if (accomplishmentActions.has(activity.action)) return true;
      return activity.status === 'success' && activity.type !== 'access';
    });
  }, [recentActivity]);

  const filteredActivity = useMemo(
    () => recentActivity.filter((activity) => !isAuthAction(activity)),
    [recentActivity]
  );

  const getActivityIcon = (type) => {
    const icons = {
      upload: <Upload size={14} aria-label="Upload" />,
      search: <Search size={14} aria-label="Search" />,
      summary: <FileText size={14} aria-label="Summary" />,
      processing: <FileText size={14} aria-label="Processing" />,
      access: <Search size={14} aria-label="Access" />,
      success: <CheckCircle size={14} aria-label="Success" />,
      failed: <AlertCircle size={14} aria-label="Failed" />,
      workspace: <FileText size={14} aria-label="Workspace" />,
    };
    return icons[type] || <FileText size={14} aria-label="Activity" />;
  };

  const getActivityTypeClass = (type) => {
    if (type === 'summary' || type === 'processing') return 'ai-ada';
    if (type === 'upload' || type === 'workspace') return 'ai-doc';
    if (type === 'search' || type === 'access') return 'ai-search';
    return 'ai-check';
  };

  const getPriorityClass = (priority) => {
    if (!priority) return 'priority-neutral';
    return `priority-${priority}`;
  };

  const getPriorityIcon = (priority) => {
    if (priority === 'high') return <ArrowUpRight size={12} aria-hidden="true" />;
    if (priority === 'medium') return <Minus size={12} aria-hidden="true" />;
    if (priority === 'low') return <ArrowDownRight size={12} aria-hidden="true" />;
    return <Minus size={12} aria-hidden="true" />;
  };

  const getPriorityLabel = (priority) => {
    if (priority === 'high') return 'P1';
    if (priority === 'medium') return 'P2';
    if (priority === 'low') return 'P3';
    return 'P-';
  };

  const getDeadlineClass = (dueIn, isOverdue) => {
    if (isOverdue) return 'due-overdue';
    const value = (dueIn || '').toLowerCase();
    if (value.includes('today') || value.includes('tomorrow')) return 'due-soon';
    return 'due-normal';
  };

  const formatActivityAction = (value) => {
    if (!value || typeof value !== 'string') return 'Activity';
    return value
      .replace(/[._-]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const handleIssueClick = (issue) => {
    if (!issue?.workspace_id) return;
    const issueId = issue?.id || issue?.number;
    const suffix = issueId ? `?issueId=${issueId}` : '';
    navigate(`/workspace/${issue.workspace_id}/issues${suffix}`);
  };

  const handleDeadlineClick = (deadline) => {
    if (!deadline?.workspace_id) return;
    const issueId = deadline?.id;
    const suffix = issueId ? `?issueId=${issueId}` : '';
    navigate(`/workspace/${deadline.workspace_id}/issues${suffix}`);
  };

  const calendarDays = useMemo(() => {
    const firstDay = new Date(currentMonthInfo.year, currentMonthInfo.monthIndex, 1).getDay();
    const daysInMonth = new Date(currentMonthInfo.year, currentMonthInfo.monthIndex + 1, 0).getDate();
    const daysInPrevMonth = new Date(currentMonthInfo.year, currentMonthInfo.monthIndex, 0).getDate();

    const days = [];

    for (let index = firstDay - 1; index >= 0; index -= 1) {
      days.push({ day: daysInPrevMonth - index, inactive: true });
    }

    const today = new Date();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const isToday =
        today.getFullYear() === currentMonthInfo.year
        && today.getMonth() === currentMonthInfo.monthIndex
        && today.getDate() === day;
      days.push({ day, inactive: false, today: isToday });
    }

    const trailing = (7 - (days.length % 7)) % 7;
    for (let day = 1; day <= trailing; day += 1) {
      days.push({ day, inactive: true, nextMonth: true });
    }

    return days;
  }, [currentMonthInfo]);

  const deadlinesByDay = useMemo(() => {
    const grouped = new Map();
    deadlines.forEach((deadline) => {
      if (!deadline?.due_date) return;
      const dueDate = new Date(deadline.due_date);
      const dueYear = dueDate.getUTCFullYear();
      const dueMonth = dueDate.getUTCMonth();
      if (dueYear !== currentMonthInfo.year || dueMonth !== currentMonthInfo.monthIndex) return;
      const dueDay = dueDate.getUTCDate();
      if (!grouped.has(dueDay)) grouped.set(dueDay, []);
      grouped.get(dueDay).push(deadline);
    });
    return grouped;
  }, [deadlines, currentMonthInfo]);

  const selectedDeadlines = useMemo(
    () => deadlinesByDay.get(selectedDay) || [],
    [deadlinesByDay, selectedDay]
  );

  const hasEvent = (day) => deadlinesByDay.has(day);

  const monthDay = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });

  const profileInitial = (user.username || 'A').charAt(0).toUpperCase();

  return (
    <div className="dashboard-page">
      <div className="dashboard-layout">
        <aside className="dashboard-sidebar">
          <section className="dash-card profile-card">
            <div className="profile-avatar">
              <div className="avatar-ph">{profileInitial}</div>
            </div>
            <h2 className="profile-name">{user.username || 'Ada User'}</h2>
            <p className="profile-email">{user.email || '—'}</p>
            <div className="profile-meta">
              <div className="profile-row">
                <span className="profile-row-label">Member since</span>
                <span className="profile-row-value">{user.joinedDate || '—'}</span>
              </div>
              <div className="profile-row">
                <span className="profile-row-label">Workspaces</span>
                <span className="profile-row-value">{stats.workspaces}</span>
              </div>
              <div className="profile-row">
                <span className="profile-row-label">Documents</span>
                <span className="profile-row-value">{stats.documents}</span>
              </div>
              {user.status && (
                <div className="profile-row profile-row-status">
                  <span className="profile-row-label">Status</span>
                  <span className="profile-row-value profile-row-status-value">&quot;{user.status}&quot;</span>
                </div>
              )}
            </div>
          </section>

          <section className="dash-card calendar-card">
            <header className="cal-header">
              <span className="cal-title">Calendar</span>
              <div className="cal-nav">
                <button className="cal-nav-btn" type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
                  <ChevronLeft size={14} />
                </button>
                <span className="cal-month" style={{ whiteSpace: 'nowrap' }}>{currentMonth}</span>
                <button className="cal-nav-btn" type="button" aria-label="Next month" onClick={() => shiftMonth(1)}>
                  <ChevronRight size={14} />
                </button>
              </div>
            </header>

            <div className="cal-grid">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <span key={day} className="cal-label">{day}</span>
              ))}
              {calendarDays.map((day, index) => {
                const showEvent = !day.inactive && hasEvent(day.day);
                return (
                  <button
                    key={`${day.day}-${index}`}
                    type="button"
                    disabled={day.inactive}
                    className={`cal-day ${day.inactive ? 'muted' : ''} ${day.today ? 'today' : ''} ${showEvent ? 'has-event' : ''} ${selectedDay === day.day && !day.inactive ? 'selected' : ''}`}
                    onClick={() => !day.inactive && setSelectedDay(day.day)}
                  >
                    <span>{day.day}</span>
                    {showEvent && <span className="cal-event-dot" />}
                  </button>
                );
              })}
            </div>

            {selectedDeadlines.length > 0 && (
              <div className="calendar-due-list">
                <div className="calendar-due-label">Due on {currentMonth.split(' ')[0]} {selectedDay}</div>
                {selectedDeadlines.map((deadline) => (
                  <button
                    key={deadline.id}
                    type="button"
                    className="calendar-due-item"
                    onClick={() => handleDeadlineClick(deadline)}
                  >
                    <span className="calendar-due-title">{deadline.title}</span>
                    <span className="calendar-due-meta">{deadline.due_in}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>

        <section className="dashboard-top-grid">
          <article className="dash-card data-card">
            <div className="data-card-header">
              <h3 className="data-card-title">Overview</h3>
              <span className="data-card-badge">Status</span>
            </div>
            <div className="data-card-body">
              <div className="overview-row">
                <span className="overview-label">Recent Items</span>
                <span className="overview-value">{stats.recentItems}</span>
              </div>
              <div className="overview-row">
                <span className="overview-label">Open Tasks</span>
                <span className="overview-value">{stats.openTasks}</span>
              </div>
              <div className="overview-row">
                <span className="overview-label">Overdue</span>
                <span className="overview-value overdue">{stats.overdueTasks}</span>
              </div>
            </div>
          </article>

          <article className="dash-card data-card">
            <div className="data-card-header">
              <h3 className="data-card-title">Accomplishments</h3>
              <span className="data-card-badge">
                <CheckCircle size={12} />
                {accomplishments.length} completed from activity
              </span>
            </div>
            <div className="data-card-body">
              {accomplishments.length === 0 ? (
                <p className="empty-line">No completed items yet</p>
              ) : (
                accomplishments.slice(0, 4).map((item, index) => (
                  <div key={`${item.title || item.action}-${index}`} className="overview-row">
                    <span className="accomplish-text">{item.title || item.meta || formatActivityAction(item.action) || 'Completed item'}</span>
                    <span className="accomplish-time">{item.time || '—'}</span>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="dash-card data-card">
            <div className="data-card-header">
              <h3 className="data-card-title">Open Issues</h3>
              <span className="data-card-badge">
                <AlertCircle size={12} />
                {issues.length} issues
              </span>
            </div>
            <div className="data-card-body">
              {issues.length === 0 ? (
                <p className="empty-line">No open issues</p>
              ) : (
                issues.slice(0, 4).map((issue) => (
                  <div
                    key={issue.id || issue.number}
                    className="overview-row overview-row-clickable issue-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleIssueClick(issue)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleIssueClick(issue);
                      }
                    }}
                  >
                    <span className="issue-id">#{issue.number || issue.id}</span>
                    <span className="issue-title">{issue.title}</span>
                    <span className={`issue-priority ${getPriorityClass(issue.priority)}`}>
                      {getPriorityIcon(issue.priority)}
                      {getPriorityLabel(issue.priority)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="dash-card data-card">
            <div className="data-card-header">
              <h3 className="data-card-title">Upcoming Deadlines</h3>
              <span className="data-card-badge">
                <Clock size={12} />
                {deadlines.length} deadlines
              </span>
            </div>
            <div className="data-card-body">
              {deadlines.length === 0 ? (
                <p className="empty-line">No upcoming deadlines</p>
              ) : (
                deadlines.slice(0, 4).map((deadline) => (
                  <div
                    key={deadline.id}
                    className="overview-row overview-row-clickable deadline-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleDeadlineClick(deadline)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleDeadlineClick(deadline);
                      }
                    }}
                  >
                    <span className="deadline-title">{deadline.title}</span>
                    <span className={`deadline-badge ${getDeadlineClass(deadline.due_in, deadline.is_overdue)}`}>{deadline.due_in}</span>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>

        <section className="dashboard-bottom">
          <article className="dash-card activity-card">
            <div className="activity-header-row">
              <h3 className="activity-title">Recent Activity</h3>
              <button type="button" className="view-all-btn">View All</button>
            </div>

            <div className="activity-tabs">
              <button className={`activity-tab ${activityFilter === 'all' ? 'active' : ''}`} onClick={() => setActivityFilter('all')}>All</button>
              <button className={`activity-tab ${activityFilter === 'documents' ? 'active' : ''}`} onClick={() => setActivityFilter('documents')}>Documents</button>
              <button className={`activity-tab ${activityFilter === 'searches' ? 'active' : ''}`} onClick={() => setActivityFilter('searches')}>Searches</button>
              <button className={`activity-tab ${activityFilter === 'workspaces' ? 'active' : ''}`} onClick={() => setActivityFilter('workspaces')}>Workspaces</button>
            </div>

            <div className="activity-date">{monthDay}</div>

            <div className="activity-list">
              {filteredActivity.length === 0 ? (
                <p className="empty-line">No recent activity</p>
              ) : (
                filteredActivity.map((activity, index) => (
                  <div key={`${activity.action}-${index}`} className="activity-item">
                    <div className={`activity-icon ${getActivityTypeClass(activity.type)}`}>
                      {getActivityIcon(activity.type)}
                    </div>
                    <div className="activity-body">
                      <div className="activity-user">{activity.username || user.username || 'User'}</div>
                      <div className="activity-desc">{activity.title || formatActivityAction(activity.action)}</div>
                      {activity.meta && <div className="activity-excerpt">{activity.meta}</div>}
                    </div>
                    <span className="activity-time">{activity.time || '—'}</span>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}

export default Dashboard;
