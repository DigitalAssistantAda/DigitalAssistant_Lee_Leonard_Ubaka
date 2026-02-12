import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, FileText, Folder, Search, Upload, Eye, XCircle, AlertCircle, Clock, ArrowUpRight, Minus, ArrowDownRight } from 'lucide-react';
import './Dashboard.css';

function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    workspaces: 0,
    documents: 0,
    recentItems: 0,
    openTasks: 0,
    overdueTasks: 0
  });
  const [user, setUser] = useState({
    username: '',
    email: '',
    joinedDate: '',
    status: ''
  });
  const [recentActivity, setRecentActivity] = useState([]);
  const [issues, setIssues] = useState([]);
  const [deadlines, setDeadlines] = useState([]);
  const [currentMonth, setCurrentMonth] = useState('February 2026');
  const [selectedDay, setSelectedDay] = useState(1);
  const [activityFilter, setActivityFilter] = useState('all');

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const monthIndexMap = {
    January: 0,
    February: 1,
    March: 2,
    April: 3,
    May: 4,
    June: 5,
    July: 6,
    August: 7,
    September: 8,
    October: 9,
    November: 10,
    December: 11,
  };

  const currentMonthInfo = useMemo(() => {
    const [monthName, yearValue] = currentMonth.split(' ');
    const monthIndex = monthIndexMap[monthName] ?? 0;
    const year = Number.parseInt(yearValue, 10) || new Date().getFullYear();
    return { monthIndex, year };
  }, [currentMonth]);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        return;
      }

      // Fetch dashboard stats
      const statsResponse = await fetch(`${API_URL}/api/v1/dashboard/stats`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setStats({
          workspaces: statsData.workspaces,
          documents: statsData.documents,
          recentItems: statsData.recent_items,
          openTasks: 0,
          overdueTasks: 0
        });
        setUser({
          username: statsData.username,
          email: statsData.email,
          joinedDate: statsData.member_since,
          status: 'Working on capstone project'
        });
      }

      // Fetch recent activity
      const activityResponse = await fetch(`${API_URL}/api/v1/dashboard/activity?limit=8`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (activityResponse.ok) {
        const activityData = await activityResponse.json();
        setRecentActivity(activityData.items || []);
      }

      // Fetch issues
      const issuesResponse = await fetch(`${API_URL}/api/v1/dashboard/issues`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (issuesResponse.ok) {
        const issuesData = await issuesResponse.json();
        const items = issuesData.items || [];
        setIssues(items);
        setStats((prev) => ({
          ...prev,
          openTasks: items.length,
        }));
      }

      // Fetch deadlines
      const deadlinesResponse = await fetch(`${API_URL}/api/v1/dashboard/deadlines`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (deadlinesResponse.ok) {
        const deadlinesData = await deadlinesResponse.json();
        const items = deadlinesData.items || [];
        const overdueCount = items.filter((deadline) =>
          (deadline.due_in || '').toLowerCase().includes('overdue')
        ).length;
        setDeadlines(items);
        setStats((prev) => ({
          ...prev,
          overdueTasks: overdueCount,
        }));
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    }
  };

  const isAuthAction = (action) => {
    if (!action) return false;
    return action.startsWith('user.') || action.includes('login') || action.includes('logout');
  };

  const accomplishments = useMemo(() => {
    const accomplishmentActions = new Set([
      'document.uploaded',
      'document.downloaded',
      'workspace.created',
      'workspace.updated',
      'workspace.member_added',
      'workspace.member_updated',
      'workspace.member_removed'
    ]);

    return recentActivity.filter((activity) => {
      if (isAuthAction(activity.action)) return false;
      if (accomplishmentActions.has(activity.action)) return true;
      return activity.status === 'success' && activity.type !== 'access';
    });
  }, [recentActivity]);

  const filteredActivity = useMemo(() => {
    const base = recentActivity.filter((activity) => !isAuthAction(activity.action));
    if (activityFilter === 'all') return base;
    if (activityFilter === 'documents') {
      return base.filter((activity) => activity.action?.startsWith('document.'));
    }
    if (activityFilter === 'searches') {
      return base.filter((activity) => activity.type === 'search' || activity.action === 'document.viewed');
    }
    if (activityFilter === 'summaries') {
      return base.filter((activity) => activity.type === 'summary' || activity.action?.startsWith('summary.'));
    }
    if (activityFilter === 'workspaces') {
      return base.filter((activity) => activity.action?.startsWith('workspace.'));
    }
    return base;
  }, [recentActivity, activityFilter]);

  // recentActivity now comes from API

  const getActivityIcon = (type) => {
    const icons = {
      upload: <Upload size={14} aria-label="Upload" />,
      search: <Search size={14} aria-label="Search" />,
      summary: <FileText size={14} aria-label="Summary" />,
      processing: <FileText size={14} aria-label="Processing" />,
      access: <Eye size={14} aria-label="Access" />,
      success: <CheckCircle size={14} aria-label="Success" />,
      failed: <XCircle size={14} aria-label="Failed" />,
      workspace: <Folder size={14} aria-label="Workspace" />
    };
    return icons[type] || <FileText size={14} aria-label="Activity" />;
  };

  const getActivityStatusClass = (status) => {
    if (status === 'success') return 'status-success';
    if (status === 'pending') return 'status-pending';
    if (status === 'failed') return 'status-failed';
    return 'status-neutral';
  };

  const getPriorityClass = (priority) => {
    if (!priority) return 'priority-neutral';
    return `priority-${priority}`;
  };

  const getPriorityIcon = (priority) => {
    if (priority === 'high') return <ArrowUpRight size={14} aria-hidden="true" />;
    if (priority === 'medium') return <Minus size={14} aria-hidden="true" />;
    if (priority === 'low') return <ArrowDownRight size={14} aria-hidden="true" />;
    return <Minus size={14} aria-hidden="true" />;
  };

  const getPriorityLabel = (priority) => {
    if (priority === 'high') return 'P1';
    if (priority === 'medium') return 'P2';
    if (priority === 'low') return 'P3';
    return 'P-';
  };

  const getDeadlineClass = (dueIn) => {
    const value = (dueIn || '').toLowerCase();
    if (value.includes('overdue')) return 'due-overdue';
    if (value.includes('today') || value.includes('tomorrow')) return 'due-soon';
    return 'due-normal';
  };

  const handleIssueClick = (issue) => {
    if (!issue?.workspace_id) return;
    const issueId = issue?.id || issue?.number;
    const suffix = issueId ? `?issueId=${issueId}` : '';
    navigate(`/workspace/${issue.workspace_id}/issues${suffix}`);
  };

  const handleDeadlineClick = (deadline) => {
    if (!deadline?.workspace_id) return;
    navigate(`/workspace/${deadline.workspace_id}`);
  };

  const calendarDays = [
    { day: 26, inactive: true }, { day: 27, inactive: true }, { day: 28, inactive: true },
    { day: 29, inactive: true }, { day: 30, inactive: true }, { day: 31, inactive: true },
    { day: 1, today: true },
    ...Array.from({ length: 28 }, (_, i) => ({ day: i + 2 })),
    { day: 1, inactive: true, nextMonth: true }
  ];

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

  const selectedDeadlines = useMemo(() => (
    deadlinesByDay.get(selectedDay) || []
  ), [deadlinesByDay, selectedDay]);

  const hasEvent = (day) => deadlinesByDay.has(day);

  return (
    <div className="dashboard-container">
      <div className="dashboard-content">
        {/* Main Layout */}
        <div className="main-layout">
          {/* Left Sidebar */}
          <div className="left-sidebar">
            {/* User Profile Card */}
            <div className="user-profile-card">
              <div className="user-avatar">
                {user.username.charAt(0).toUpperCase()}
              </div>
              <div className="user-name">{user.username}</div>
              <div className="user-email">{user.email}</div>
              <div className="user-stats">
                <div className="user-stat-item">
                  <span className="user-stat-label">Member since</span>
                  <span className="user-stat-value">{user.joinedDate}</span>
                </div>
                <div className="user-stat-item">
                  <span className="user-stat-label">Workspaces</span>
                  <span className="user-stat-value">{stats.workspaces}</span>
                </div>
                <div className="user-stat-item">
                  <span className="user-stat-label">Documents</span>
                  <span className="user-stat-value">{stats.documents}</span>
                </div>
              </div>
              {user.status && (
                <div className="user-status">
                  <div className="user-status-label">Status</div>
                  <div className="user-status-text">"{user.status}"</div>
                </div>
              )}
            </div>

            {/* Calendar */}
            <div className="calendar-container">
              <div className="calendar-header">
                <h2 className="calendar-title">Calendar</h2>
                <div className="calendar-nav">
                  <button
                    type="button"
                    className="calendar-nav-btn"
                    aria-label="Previous month"
                    disabled
                  >
                    ←
                  </button>
                  <span className="calendar-month" aria-live="polite">
                    {currentMonth}
                  </span>
                  <button
                    type="button"
                    className="calendar-nav-btn"
                    aria-label="Next month"
                    disabled
                  >
                    →
                  </button>
                </div>
              </div>
              <div className="calendar-grid">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="calendar-day header">{day}</div>
                ))}
                {calendarDays.map((day, index) => {
                  const showEvent = !day.inactive && hasEvent(day.day);
                  return (
                    <div
                      key={index}
                      className={`calendar-day ${day.inactive ? 'inactive' : 'active'} ${day.today ? 'today' : ''} ${showEvent ? 'has-event' : ''}`}
                      onClick={() => !day.inactive && setSelectedDay(day.day)}
                    >
                      <span className="calendar-day-number">{day.day}</span>
                      {showEvent && <span className="calendar-event-dot" aria-label="Due items" />}
                    </div>
                  );
                })}
              </div>
              {selectedDeadlines.length > 0 && (
                <div className="calendar-due-list" aria-live="polite">
                  <div className="calendar-due-label">
                    Due on {currentMonth.split(' ')[0]} {selectedDay}
                  </div>
                  {selectedDeadlines.map((deadline) => (
                    <button
                      key={deadline.id}
                      type="button"
                      className="calendar-due-item"
                      onClick={() => handleDeadlineClick(deadline)}
                      title={`View ${deadline.title}`}
                      aria-label={`View ${deadline.title}`}
                    >
                      <span className="calendar-due-title">{deadline.title}</span>
                      <span className="calendar-due-meta">{deadline.due_in}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Content */}
          <div>
            {/* Dashboard Grid */}
            <div className="dashboard-grid">
          {/* Overview Card */}
          <div className="dashboard-card">
            <div className="card-header">
              <h2 className="card-title">Overview</h2>
              <span className="card-badge">Status</span>
            </div>
            <div className="card-content">
              <div className="status-items">
                <div className="status-item">
                  <span className="status-label">Recent Items</span>
                  <span className="status-count">{stats.recentItems}</span>
                </div>
                <div className="status-item">
                  <span className="status-label">Open Tasks</span>
                  <span className="status-count">{stats.openTasks}</span>
                </div>
                <div className="status-item overdue">
                  <span className="status-label">Overdue</span>
                  <span className="status-count">{stats.overdueTasks}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Accomplishments Card */}
          <div className="dashboard-card">
            <div className="card-header">
              <h2 className="card-title">Accomplishments</h2>
              <span className="card-badge" title="Completed from recent activity" aria-label="Completed from recent activity">
                <CheckCircle size={16} />
                {accomplishments.length} completed from activity
              </span>
            </div>
            <div className="card-content">
              <div className="accomplishment-list">
                {accomplishments.length === 0 ? (
                  <div className="empty-state">
                    <p className="empty-state-text">No completed items yet</p>
                  </div>
                ) : (
                  accomplishments.map((item, index) => (
                    <div key={index} className="accomplishment-item">
                      <div className="accomplishment-text">{item.title || item.meta || 'Completed item'}</div>
                      <div className="accomplishment-time">{item.time || '—'}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Issues Card */}
          <div className="dashboard-card">
            <div className="card-header">
              <h2 className="card-title">Open Issues</h2>
              <span className="card-badge" title="Open and in-progress issues" aria-label="Open and in-progress issues">
                <AlertCircle size={16} />
                {issues.length} issues
              </span>
            </div>
            <div className="card-content">
              <div className="issues-list">
                {issues.length === 0 ? (
                  <div className="empty-state">
                    <p className="empty-state-text">No open issues</p>
                  </div>
                ) : (
                  issues.map((issue, index) => (
                    <button
                      key={index}
                      type="button"
                      className="issue-item"
                      onClick={() => handleIssueClick(issue)}
                      title="View issue details"
                      aria-label={`View issue ${issue.number}`}
                    >
                      <span
                        className="issue-meta-pill"
                        title={`Issue #${issue.number}`}
                        aria-label={`Issue number ${issue.number}`}
                      >
                        #{issue.number}
                      </span>
                      <div className="issue-main">
                        <div className="issue-title">{issue.title}</div>
                      </div>
                      <div className="issue-pills">
                        <span
                          className={`issue-priority-pill ${getPriorityClass(issue.priority)}`}
                          title={`Priority ${getPriorityLabel(issue.priority)}`}
                          aria-label={`Priority ${getPriorityLabel(issue.priority)}`}
                        >
                          {getPriorityIcon(issue.priority)}
                          <span className="issue-priority-label">{getPriorityLabel(issue.priority)}</span>
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Deadlines Card */}
          <div className="dashboard-card">
            <div className="card-header">
              <h2 className="card-title">Upcoming Deadlines</h2>
              <span className="card-badge" title="Upcoming and overdue deadlines" aria-label="Upcoming and overdue deadlines">
                <Clock size={16} />
                {deadlines.length} deadlines
              </span>
            </div>
            <div className="card-content">
              <div className="deadlines-list">
                {deadlines.length === 0 ? (
                  <div className="empty-state">
                    <p className="empty-state-text">No upcoming deadlines</p>
                  </div>
                ) : (
                  deadlines.map((deadline, index) => (
                    <button
                      key={index}
                      type="button"
                      className="deadline-item"
                      onClick={() => handleDeadlineClick(deadline)}
                      title="View deadline details"
                      aria-label={`View deadline ${deadline.title}`}
                    >
                      <div className="deadline-title">{deadline.title}</div>
                      <span
                        className={`deadline-pill ${getDeadlineClass(deadline.due_in)}`}
                        title={`Due ${deadline.due_in}`}
                        aria-label={`Due ${deadline.due_in}`}
                      >
                        {deadline.due_in}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

            {/* Activity Timeline */}
            <div className="bottom-section">
              <div className="activity-workspace">
                <div className="workspace-header">
                  <div className="activity-header">
                    <h2 className="workspace-title">Recent Activity</h2>
                    <button className="activity-view-all">
                      View All
                    </button>
                  </div>
                  <div className="activity-filters">
                    <button className={`filter-btn ${activityFilter === 'all' ? 'active' : ''}`} onClick={() => setActivityFilter('all')}>All</button>
                    <button className={`filter-btn ${activityFilter === 'documents' ? 'active' : ''}`} onClick={() => setActivityFilter('documents')}>Documents</button>
                    <button className={`filter-btn ${activityFilter === 'searches' ? 'active' : ''}`} onClick={() => setActivityFilter('searches')}>Searches</button>
                    <button className={`filter-btn ${activityFilter === 'summaries' ? 'active' : ''}`} onClick={() => setActivityFilter('summaries')}>Summaries</button>
                    <button className={`filter-btn ${activityFilter === 'workspaces' ? 'active' : ''}`} onClick={() => setActivityFilter('workspaces')}>Workspaces</button>
                  </div>
                </div>
                <div className="activity-timeline">
                  {filteredActivity.map((activity, index) => (
                    <div key={index} className="timeline-item">
                      <div 
                        className={`timeline-marker ${getActivityStatusClass(activity.status)}`}
                      >
                        <span className={`timeline-icon ${getActivityStatusClass(activity.status)}`}>
                          {getActivityIcon(activity.type)}
                        </span>
                      </div>
                      <div className="timeline-content">
                        <div className="timeline-title">{activity.title}</div>
                        <div className="timeline-meta">
                          <span>{activity.meta}</span>
                          <span className="timeline-time">{activity.time}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
