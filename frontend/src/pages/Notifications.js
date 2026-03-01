import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, XCircle, Clock } from 'lucide-react';
import './Notifications.css';

function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('pending'); // pending, approved, denied, all
  const navigate = useNavigate();
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  useEffect(() => {
    fetchNotifications();
  }, [filter]);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const endpoint = filter === 'pending' ? 'pending' : 'all';
      const response = await fetch(`${API_URL}/api/v1/deletion-requests/${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (!response.ok) {
        setNotifications([]);
        return;
      }
      const data = await response.json();
      setNotifications(data.requests || []);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      setNotifications([]);
    }
    setLoading(false);
  };

  const handleApprove = async (requestId) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/deletion-requests/${requestId}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (response.ok) {
        fetchNotifications();
      }
    } catch (error) {
      console.error('Error approving request:', error);
    }
  };

  const handleDeny = async (requestId) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/deletion-requests/${requestId}/deny`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (response.ok) {
        fetchNotifications();
      }
    } catch (error) {
      console.error('Error denying request:', error);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'approved':
        return <CheckCircle size={20} className="status-icon approved" />;
      case 'denied':
        return <XCircle size={20} className="status-icon denied" />;
      case 'pending':
        return <Clock size={20} className="status-icon pending" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status) => {
    return <span className={`status-badge ${status}`}>{status}</span>;
  };

  const pendingNotifications = notifications.filter(n => n.status === 'pending');
  const respondedNotifications = notifications.filter(n => n.status !== 'pending');
  const displayNotifications = filter === 'pending' ? pendingNotifications : notifications;
  const displayResponded = displayNotifications.filter(n => n.status !== 'pending');

  return (
    <div className="notifications-page">
      <div className="notifications-header">
        <button 
          className="back-btn"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <ArrowLeft size={24} />
        </button>
        <h1>Notifications</h1>
        <div className="header-spacer"></div>
      </div>

      <div className="notifications-container">
        <div className="filter-tabs">
          <button 
            className={`filter-tab ${filter === 'pending' ? 'active' : ''}`}
            onClick={() => setFilter('pending')}
          >
            Pending ({pendingNotifications.length})
          </button>
          <button 
            className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({notifications.length})
          </button>
        </div>

        <div className="notifications-list">
          {loading && (
            <div className="loading-state">
              <p>Loading notifications...</p>
            </div>
          )}

          {!loading && displayNotifications.length === 0 && (
            <div className="empty-state">
              <Clock size={48} />
              <h2>No notifications</h2>
              <p>You're all caught up!</p>
            </div>
          )}

          {!loading && pendingNotifications.length > 0 && (
            <>
              <div className="section-title">Awaiting Your Decision</div>
              {pendingNotifications.map(notification => (
                <div key={notification.id} className="notification-card pending-card">
                  <div className="notification-content">
                    <div className="notification-header">
                      <h3>Document Deletion Request</h3>
                      {getStatusBadge(notification.status)}
                    </div>
                    <p className="notification-reason">
                      <strong>Reason:</strong> {notification.reason || 'No reason provided'}
                    </p>
                    <p className="notification-date">
                      Requested on {new Date(notification.created_at).toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                  <div className="notification-actions">
                    <button 
                      className="btn btn-approve"
                      onClick={() => handleApprove(notification.id)}
                    >
                      Approve
                    </button>
                    <button 
                      className="btn btn-deny"
                      onClick={() => handleDeny(notification.id)}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {!loading && displayResponded.length > 0 && (
            <>
              <div className="section-title">History</div>
              {displayResponded.map(notification => (
                <div key={notification.id} className="notification-card responded-card">
                  <div className="notification-content">
                    <div className="notification-header">
                      <div className="status-with-icon">
                        {getStatusIcon(notification.status)}
                        <h3>Document Deletion Request</h3>
                      </div>
                      {getStatusBadge(notification.status)}
                    </div>
                    <p className="notification-reason">
                      <strong>Reason:</strong> {notification.reason || 'No reason provided'}
                    </p>
                    <p className="notification-date">
                      {notification.status === 'approved' ? 'Approved' : 'Denied'} on{' '}
                      {notification.responded_at 
                        ? new Date(notification.responded_at).toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })
                        : 'Unknown date'
                      }
                    </p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default NotificationsPage;