-- Ronde schema (single initial migration while the app is in development)


-- CreateEnum
CREATE TYPE "InstanceRole" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('superadmin', 'support', 'finance', 'sales');

-- CreateEnum
CREATE TYPE "ConnectorKind" AS ENUM ('email', 'matrix', 'slack', 'teams', 'discord', 'mattermost', 'webhook', 'sms', 'whatsapp');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "TrackerKind" AS ENUM ('jira', 'linear', 'gitlab', 'github');

-- CreateEnum
CREATE TYPE "WikiKind" AS ENUM ('notion', 'confluence');

-- CreateEnum
CREATE TYPE "VideoKind" AS ENUM ('zoom', 'meet', 'teams');

-- CreateEnum
CREATE TYPE "CalendarKind" AS ENUM ('google', 'microsoft');

-- CreateEnum
CREATE TYPE "MeetingRole" AS ENUM ('host', 'cohost', 'participant', 'observer');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('current', 'archived');

-- CreateEnum
CREATE TYPE "SectionRole" AS ENUM ('achievement', 'plan', 'blocker', 'note', 'custom');

-- CreateEnum
CREATE TYPE "SectionInput" AS ENUM ('list', 'checklist', 'text');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('daily', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "ExceptionKind" AS ENUM ('cancel', 'move', 'keep');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('yes', 'no');

-- CreateEnum
CREATE TYPE "NotifyEvent" AS ENUM ('session_soon', 'session_started', 'minutes_published', 'checkin_reminder', 'action_overdue', 'birthday');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('open', 'doing', 'done');

-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('hand', 'question');

-- CreateEnum
CREATE TYPE "PollKind" AS ENUM ('single', 'multiple', 'scale', 'words');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('proposed', 'active', 'paused', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "ProjectHealth" AS ENUM ('onTrack', 'atRisk', 'offTrack');

-- CreateEnum
CREATE TYPE "ProjectVisibility" AS ENUM ('workspace', 'members');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('owner', 'admin', 'billing', 'organizer', 'member', 'guest');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('active', 'suspended');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "locale" TEXT,
    "timezone" TEXT,
    "instanceRole" "InstanceRole" NOT NULL DEFAULT 'user',
    "twoFactorEnabled" BOOLEAN DEFAULT false,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwoFactor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "failedVerificationCount" INTEGER DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "TwoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "publicKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialID" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    "createdAt" TIMESTAMP(3),
    "aaguid" TEXT,

    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstanceSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPref" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPref_pkey" PRIMARY KEY ("userId","key")
);

-- CreateTable
CREATE TABLE "FeedToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "meetingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "totpSecret" TEXT,
    "totpConfirmedAt" TIMESTAMP(3),
    "totpLastStep" INTEGER,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSession" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAudit" (
    "id" TEXT NOT NULL,
    "staffId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanGrant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedLicense" (
    "id" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "email" TEXT,
    "edition" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "key" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "issuedBy" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "IssuedLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organisation" TEXT,
    "message" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connector" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "ConnectorKind" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "ruleId" TEXT,
    "meetingId" TEXT,
    "event" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueTracker" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "TrackerKind" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueTracker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wiki" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "WikiKind" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wiki_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WikiPage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "wikiId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WikiPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "VideoKind" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "CalendarKind" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "workspaceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'incomplete',
    "plan" TEXT NOT NULL DEFAULT 'team',
    "seats" INTEGER NOT NULL DEFAULT 1,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorLabel" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL DEFAULT '',
    "targetId" TEXT,
    "meetingId" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomRole" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceDomain" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "capture" BOOLEAN NOT NULL DEFAULT false,
    "enforceSso" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoProvider" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "oidcConfig" TEXT,
    "samlConfig" TEXT,
    "userId" TEXT,
    "organizationId" TEXT,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LdapDirectory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "startTls" BOOLEAN NOT NULL DEFAULT false,
    "bindDn" TEXT NOT NULL,
    "bindPassword" TEXT NOT NULL DEFAULT '',
    "baseDn" TEXT NOT NULL,
    "userFilter" TEXT NOT NULL DEFAULT '(&(objectClass=person)(mail={{email}}))',
    "emailAttribute" TEXT NOT NULL DEFAULT 'mail',
    "nameAttribute" TEXT NOT NULL DEFAULT 'cn',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LdapDirectory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScimToken" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '',
    "locale" TEXT,
    "timezone" TEXT,
    "holidays" TEXT,
    "hostLabel" TEXT NOT NULL DEFAULT '',
    "videoUrl" TEXT NOT NULL DEFAULT '',
    "calendarAccountId" TEXT,
    "wikiId" TEXT,
    "transcription" BOOLEAN NOT NULL DEFAULT false,
    "announcements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "appearance" JSONB NOT NULL DEFAULT '{}',
    "agenda" JSONB,
    "speakSec" INTEGER NOT NULL DEFAULT 120,
    "autoStart" BOOLEAN NOT NULL DEFAULT true,
    "targetMin" INTEGER NOT NULL DEFAULT 25,
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reminderWhen" TEXT NOT NULL DEFAULT 'dayBefore',
    "reminderTime" TEXT NOT NULL DEFAULT '15:00',
    "reminderLastSentFor" TEXT,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingParticipant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "MeetingRole" NOT NULL DEFAULT 'participant',
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "remind" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "role" "SectionRole" NOT NULL DEFAULT 'custom',
    "input" "SectionInput" NOT NULL DEFAULT 'list',
    "position" INTEGER NOT NULL DEFAULT 0,
    "behavior" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "occurrenceKey" TEXT,
    "time" TEXT NOT NULL DEFAULT '10:00',
    "startsAt" TIMESTAMP(3),
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "assignments" JSONB NOT NULL DEFAULT '{}',
    "status" "SessionStatus" NOT NULL DEFAULT 'current',
    "stepKey" TEXT NOT NULL DEFAULT 'intro',
    "order" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "projectOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "projectsAdded" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "absent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "spent" JSONB NOT NULL DEFAULT '{}',
    "bonus" JSONB NOT NULL DEFAULT '{}',
    "timerRunning" BOOLEAN NOT NULL DEFAULT false,
    "timerStartedAt" TIMESTAMP(3),
    "timerBaseMs" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "record" JSONB,
    "summary" TEXT,
    "archivedAt" TIMESTAMP(3),
    "icebreaker" TEXT,
    "spotlight" JSONB,
    "draw" JSONB,
    "recordingSince" TIMESTAMP(3),
    "recordingBy" TEXT,
    "transcriptOptOut" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rev" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shownPollId" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("meetingId","personId")
);

-- CreateTable
CREATE TABLE "CheckInItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "sessionId" TEXT,
    "projectId" TEXT,
    "sectionKey" TEXT NOT NULL,
    "role" "SectionRole" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL,
    "sourceItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckInItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("sessionId","key")
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "InteractionType" NOT NULL,
    "byId" TEXT NOT NULL,
    "targetId" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "stepKey" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reaction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "byId" TEXT,
    "stepKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IcebreakerAnswer" (
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IcebreakerAnswer_pkey" PRIMARY KEY ("sessionId","byId")
);

-- CreateTable
CREATE TABLE "Kudo" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Kudo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("sessionId","personId")
);

-- CreateTable
CREATE TABLE "Mood" (
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mood_pkey" PRIMARY KEY ("sessionId","personId")
);

-- CreateTable
CREATE TABLE "CheckInItemContributor" (
    "workspaceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckInItemContributor_pkey" PRIMARY KEY ("itemId","personId")
);

-- CreateTable
CREATE TABLE "CheckInComment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckInComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "byId" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "parked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicVote" (
    "workspaceId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,

    CONSTRAINT "TopicVote_pkey" PRIMARY KEY ("topicId","personId")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'open',
    "originDate" TEXT,
    "originText" TEXT,
    "externalRef" JSONB,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleInstallation" (
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleInstallation_pkey" PRIMARY KEY ("meetingId","moduleId")
);

-- CreateTable
CREATE TABLE "ScheduleRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "freq" "Frequency" NOT NULL DEFAULT 'weekly',
    "interval" INTEGER NOT NULL DEFAULT 1,
    "byDay" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "setPos" INTEGER,
    "monthDay" INTEGER,
    "startDate" TEXT NOT NULL,
    "until" TEXT,
    "count" INTEGER,
    "time" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleException" (
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "originalDate" TEXT NOT NULL,
    "kind" "ExceptionKind" NOT NULL,
    "date" TEXT,
    "time" TEXT,
    "durationMin" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleException_pkey" PRIMARY KEY ("ruleId","originalDate")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("meetingId","occurrenceKey","personId")
);

-- CreateTable
CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "event" "NotifyEvent" NOT NULL,
    "target" JSONB NOT NULL DEFAULT '{}',
    "options" JSONB NOT NULL DEFAULT '{}',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "message" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioChunk" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "type" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL,
    "stepKey" TEXT,
    "speakerId" TEXT,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PokerItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "revealed" BOOLEAN NOT NULL DEFAULT false,
    "final" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PokerItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PokerVote" (
    "workspaceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PokerVote_pkey" PRIMARY KEY ("itemId","personId")
);

-- CreateTable
CREATE TABLE "Poll" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "kind" "PollKind" NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "anonymous" BOOLEAN NOT NULL DEFAULT true,
    "open" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollAnswer" (
    "workspaceId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "values" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollAnswer_pkey" PRIMARY KEY ("pollId","personId")
);

-- CreateTable
CREATE TABLE "ProjectTheme" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "color" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProjectTheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "themeId" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'active',
    "health" "ProjectHealth",
    "leadId" TEXT,
    "startDate" TEXT,
    "targetDate" TEXT,
    "links" JSONB NOT NULL DEFAULT '[]',
    "source" JSONB,
    "sourceKey" TEXT,
    "sourceTrackerId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "color" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "parentId" TEXT,
    "visibility" "ProjectVisibility" NOT NULL DEFAULT 'workspace',
    "membersEdit" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectLogo" (
    "projectId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "type" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectLogo_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId","personId")
);

-- CreateTable
CREATE TABLE "MeetingProject" (
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MeetingProject_pkey" PRIMARY KEY ("meetingId","projectId")
);

-- CreateTable
CREATE TABLE "ProjectUpdate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sessionId" TEXT,
    "health" "ProjectHealth",
    "headline" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "headlineById" TEXT,
    "editingById" TEXT,
    "editingUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetroCard" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "column" TEXT NOT NULL,
    "groupId" TEXT,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetroCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetroGroup" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "column" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetroGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetroVote" (
    "workspaceId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetroVote_pkey" PRIMARY KEY ("groupId","personId")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '📋',
    "data" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "plan" TEXT NOT NULL DEFAULT 'community',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendReason" TEXT,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'member',
    "customRoleId" TEXT,
    "status" "MemberStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL DEFAULT '',
    "birthday" TEXT,
    "jobCategoryId" TEXT,
    "color" INTEGER NOT NULL DEFAULT 0,
    "handles" JSONB NOT NULL DEFAULT '{}',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "locale" TEXT,
    "timezone" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "deprovisionedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingImage" (
    "meetingId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "type" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingImage_pkey" PRIMARY KEY ("meetingId")
);

-- CreateTable
CREATE TABLE "PersonAvatar" (
    "personId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "type" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonAvatar_pkey" PRIMARY KEY ("personId")
);

-- CreateTable
CREATE TABLE "JobCategory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JobCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "personId" TEXT,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'member',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "meetingId" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "href" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "pushedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceLogo" (
    "workspaceId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "type" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceLogo_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "delegateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_token_key" ON "AuthSession"("token");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE INDEX "TwoFactor_secret_idx" ON "TwoFactor"("secret");

-- CreateIndex
CREATE INDEX "TwoFactor_userId_idx" ON "TwoFactor"("userId");

-- CreateIndex
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");

-- CreateIndex
CREATE INDEX "Passkey_credentialID_idx" ON "Passkey"("credentialID");

-- CreateIndex
CREATE UNIQUE INDEX "FeedToken_tokenHash_key" ON "FeedToken"("tokenHash");

-- CreateIndex
CREATE INDEX "FeedToken_userId_idx" ON "FeedToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSession_tokenHash_key" ON "StaffSession"("tokenHash");

-- CreateIndex
CREATE INDEX "StaffSession_staffId_idx" ON "StaffSession"("staffId");

-- CreateIndex
CREATE INDEX "StaffAudit_createdAt_idx" ON "StaffAudit"("createdAt");

-- CreateIndex
CREATE INDEX "StaffAudit_targetType_targetId_idx" ON "StaffAudit"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "PlanGrant_workspaceId_idx" ON "PlanGrant"("workspaceId");

-- CreateIndex
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Connector_workspaceId_idx" ON "Connector"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Connector_id_workspaceId_key" ON "Connector"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_key_key" ON "Delivery"("key");

-- CreateIndex
CREATE INDEX "Delivery_workspaceId_createdAt_idx" ON "Delivery"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Delivery_connectorId_idx" ON "Delivery"("connectorId");

-- CreateIndex
CREATE INDEX "IssueTracker_workspaceId_idx" ON "IssueTracker"("workspaceId");

-- CreateIndex
CREATE INDEX "Wiki_workspaceId_idx" ON "Wiki"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Wiki_id_workspaceId_key" ON "Wiki"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "WikiPage_workspaceId_idx" ON "WikiPage"("workspaceId");

-- CreateIndex
CREATE INDEX "WikiPage_wikiId_idx" ON "WikiPage"("wikiId");

-- CreateIndex
CREATE UNIQUE INDEX "WikiPage_sessionId_wikiId_key" ON "WikiPage"("sessionId", "wikiId");

-- CreateIndex
CREATE INDEX "VideoAccount_workspaceId_idx" ON "VideoAccount"("workspaceId");

-- CreateIndex
CREATE INDEX "CalendarAccount_workspaceId_idx" ON "CalendarAccount"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarAccount_id_workspaceId_key" ON "CalendarAccount"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "CalendarEvent_workspaceId_idx" ON "CalendarEvent"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_meetingId_occurrenceKey_key" ON "CalendarEvent"("meetingId", "occurrenceKey");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_customerId_key" ON "Subscription"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_subscriptionId_key" ON "Subscription"("subscriptionId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_action_idx" ON "AuditLog"("workspaceId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_id_workspaceId_key" ON "CustomRole"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomRole_workspaceId_name_key" ON "CustomRole"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "WorkspaceDomain_domain_idx" ON "WorkspaceDomain"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceDomain_workspaceId_domain_key" ON "WorkspaceDomain"("workspaceId", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "SsoProvider_providerId_key" ON "SsoProvider"("providerId");

-- CreateIndex
CREATE INDEX "SsoProvider_workspaceId_idx" ON "SsoProvider"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "LdapDirectory_workspaceId_key" ON "LdapDirectory"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "LdapDirectory_id_workspaceId_key" ON "LdapDirectory"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ScimToken_tokenHash_key" ON "ScimToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ScimToken_workspaceId_idx" ON "ScimToken"("workspaceId");

-- CreateIndex
CREATE INDEX "Meeting_workspaceId_idx" ON "Meeting"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_id_workspaceId_key" ON "Meeting"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "MeetingParticipant_workspaceId_idx" ON "MeetingParticipant"("workspaceId");

-- CreateIndex
CREATE INDEX "MeetingParticipant_personId_idx" ON "MeetingParticipant"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingParticipant_meetingId_personId_key" ON "MeetingParticipant"("meetingId", "personId");

-- CreateIndex
CREATE INDEX "Section_workspaceId_idx" ON "Section"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Section_meetingId_key_key" ON "Section"("meetingId", "key");

-- CreateIndex
CREATE INDEX "Session_workspaceId_idx" ON "Session"("workspaceId");

-- CreateIndex
CREATE INDEX "Session_meetingId_status_idx" ON "Session"("meetingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Session_id_workspaceId_key" ON "Session"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_meetingId_date_key" ON "Session"("meetingId", "date");

-- CreateIndex
CREATE INDEX "CheckIn_workspaceId_idx" ON "CheckIn"("workspaceId");

-- CreateIndex
CREATE INDEX "CheckInItem_meetingId_personId_sessionId_idx" ON "CheckInItem"("meetingId", "personId", "sessionId");

-- CreateIndex
CREATE INDEX "CheckInItem_sessionId_idx" ON "CheckInItem"("sessionId");

-- CreateIndex
CREATE INDEX "CheckInItem_projectId_idx" ON "CheckInItem"("projectId");

-- CreateIndex
CREATE INDEX "CheckInItem_workspaceId_idx" ON "CheckInItem"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckInItem_id_workspaceId_key" ON "CheckInItem"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "Note_workspaceId_idx" ON "Note"("workspaceId");

-- CreateIndex
CREATE INDEX "Interaction_sessionId_idx" ON "Interaction"("sessionId");

-- CreateIndex
CREATE INDEX "Interaction_workspaceId_idx" ON "Interaction"("workspaceId");

-- CreateIndex
CREATE INDEX "Reaction_sessionId_idx" ON "Reaction"("sessionId");

-- CreateIndex
CREATE INDEX "Reaction_workspaceId_idx" ON "Reaction"("workspaceId");

-- CreateIndex
CREATE INDEX "IcebreakerAnswer_workspaceId_idx" ON "IcebreakerAnswer"("workspaceId");

-- CreateIndex
CREATE INDEX "Kudo_sessionId_idx" ON "Kudo"("sessionId");

-- CreateIndex
CREATE INDEX "Kudo_workspaceId_idx" ON "Kudo"("workspaceId");

-- CreateIndex
CREATE INDEX "Rating_workspaceId_idx" ON "Rating"("workspaceId");

-- CreateIndex
CREATE INDEX "Mood_workspaceId_idx" ON "Mood"("workspaceId");

-- CreateIndex
CREATE INDEX "CheckInComment_sessionId_ownerId_idx" ON "CheckInComment"("sessionId", "ownerId");

-- CreateIndex
CREATE INDEX "CheckInItemContributor_workspaceId_idx" ON "CheckInItemContributor"("workspaceId");

-- CreateIndex
CREATE INDEX "CheckInItemContributor_personId_idx" ON "CheckInItemContributor"("personId");

-- CreateIndex
CREATE INDEX "CheckInComment_workspaceId_idx" ON "CheckInComment"("workspaceId");

-- CreateIndex
CREATE INDEX "Topic_meetingId_idx" ON "Topic"("meetingId");

-- CreateIndex
CREATE INDEX "Topic_workspaceId_idx" ON "Topic"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_id_workspaceId_key" ON "Topic"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "TopicVote_workspaceId_idx" ON "TopicVote"("workspaceId");

-- CreateIndex
CREATE INDEX "Action_meetingId_idx" ON "Action"("meetingId");

-- CreateIndex
CREATE INDEX "Action_projectId_idx" ON "Action"("projectId");

-- CreateIndex
CREATE INDEX "Action_workspaceId_idx" ON "Action"("workspaceId");

-- CreateIndex
CREATE INDEX "ModuleInstallation_workspaceId_idx" ON "ModuleInstallation"("workspaceId");

-- CreateIndex
CREATE INDEX "ScheduleRule_meetingId_idx" ON "ScheduleRule"("meetingId");

-- CreateIndex
CREATE INDEX "ScheduleRule_workspaceId_idx" ON "ScheduleRule"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleRule_id_workspaceId_key" ON "ScheduleRule"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "ScheduleException_meetingId_idx" ON "ScheduleException"("meetingId");

-- CreateIndex
CREATE INDEX "ScheduleException_workspaceId_idx" ON "ScheduleException"("workspaceId");

-- CreateIndex
CREATE INDEX "Attendance_workspaceId_idx" ON "Attendance"("workspaceId");

-- CreateIndex
CREATE INDEX "NotificationRule_meetingId_idx" ON "NotificationRule"("meetingId");

-- CreateIndex
CREATE INDEX "NotificationRule_workspaceId_idx" ON "NotificationRule"("workspaceId");

-- CreateIndex
CREATE INDEX "AudioChunk_sessionId_idx" ON "AudioChunk"("sessionId");

-- CreateIndex
CREATE INDEX "AudioChunk_workspaceId_idx" ON "AudioChunk"("workspaceId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_sessionId_at_idx" ON "TranscriptSegment"("sessionId", "at");

-- CreateIndex
CREATE INDEX "TranscriptSegment_workspaceId_idx" ON "TranscriptSegment"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestLink_tokenHash_key" ON "GuestLink"("tokenHash");

-- CreateIndex
CREATE INDEX "GuestLink_workspaceId_idx" ON "GuestLink"("workspaceId");

-- CreateIndex
CREATE INDEX "GuestLink_meetingId_idx" ON "GuestLink"("meetingId");

-- CreateIndex
CREATE INDEX "PokerItem_sessionId_idx" ON "PokerItem"("sessionId");

-- CreateIndex
CREATE INDEX "PokerItem_workspaceId_idx" ON "PokerItem"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PokerItem_id_workspaceId_key" ON "PokerItem"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "PokerVote_workspaceId_idx" ON "PokerVote"("workspaceId");

-- CreateIndex
CREATE INDEX "Poll_sessionId_idx" ON "Poll"("sessionId");

-- CreateIndex
CREATE INDEX "Poll_workspaceId_idx" ON "Poll"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Poll_id_workspaceId_key" ON "Poll"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "PollAnswer_workspaceId_idx" ON "PollAnswer"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTheme_id_workspaceId_key" ON "ProjectTheme"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTheme_workspaceId_name_key" ON "ProjectTheme"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Project_workspaceId_status_idx" ON "Project"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_id_workspaceId_key" ON "Project"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_workspaceId_slug_key" ON "Project"("workspaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Project_workspaceId_sourceKey_key" ON "Project"("workspaceId", "sourceKey");

-- CreateIndex
CREATE INDEX "ProjectLogo_workspaceId_idx" ON "ProjectLogo"("workspaceId");

-- CreateIndex
CREATE INDEX "Project_sourceTrackerId_idx" ON "Project"("sourceTrackerId");

-- CreateIndex
CREATE INDEX "ProjectMember_workspaceId_idx" ON "ProjectMember"("workspaceId");

-- CreateIndex
CREATE INDEX "ProjectMember_personId_idx" ON "ProjectMember"("personId");

-- CreateIndex
CREATE INDEX "MeetingProject_workspaceId_idx" ON "MeetingProject"("workspaceId");

-- CreateIndex
CREATE INDEX "MeetingProject_projectId_idx" ON "MeetingProject"("projectId");

-- CreateIndex
CREATE INDEX "ProjectUpdate_meetingId_projectId_sessionId_idx" ON "ProjectUpdate"("meetingId", "projectId", "sessionId");

-- CreateIndex
CREATE INDEX "ProjectUpdate_projectId_sessionId_idx" ON "ProjectUpdate"("projectId", "sessionId");

-- CreateIndex
CREATE INDEX "ProjectUpdate_workspaceId_idx" ON "ProjectUpdate"("workspaceId");

-- CreateIndex
CREATE INDEX "RetroCard_sessionId_idx" ON "RetroCard"("sessionId");

-- CreateIndex
CREATE INDEX "RetroCard_workspaceId_idx" ON "RetroCard"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "RetroCard_id_workspaceId_key" ON "RetroCard"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "RetroGroup_sessionId_idx" ON "RetroGroup"("sessionId");

-- CreateIndex
CREATE INDEX "RetroGroup_workspaceId_idx" ON "RetroGroup"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "RetroGroup_id_workspaceId_key" ON "RetroGroup"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "RetroVote_workspaceId_idx" ON "RetroVote"("workspaceId");

-- CreateIndex
CREATE INDEX "Template_workspaceId_idx" ON "Template"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_id_workspaceId_key" ON "Template"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_personId_key" ON "WorkspaceMember"("personId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_personId_workspaceId_key" ON "WorkspaceMember"("personId", "workspaceId");

-- CreateIndex
CREATE INDEX "Person_workspaceId_active_idx" ON "Person"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Person_id_workspaceId_key" ON "Person"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_workspaceId_email_key" ON "Person"("workspaceId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Person_workspaceId_userId_key" ON "Person"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "PersonAvatar_workspaceId_idx" ON "PersonAvatar"("workspaceId");

-- CreateIndex
CREATE INDEX "MeetingImage_workspaceId_idx" ON "MeetingImage"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingImage_meetingId_workspaceId_key" ON "MeetingImage"("meetingId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "JobCategory_id_workspaceId_key" ON "JobCategory"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "JobCategory_workspaceId_name_key" ON "JobCategory"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_workspaceId_email_idx" ON "Invitation"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "InboxItem_personId_createdAt_idx" ON "InboxItem"("personId", "createdAt");

-- CreateIndex
CREATE INDEX "InboxItem_workspaceId_idx" ON "InboxItem"("workspaceId");

-- CreateIndex
CREATE INDEX "InboxItem_pushedAt_createdAt_idx" ON "InboxItem"("pushedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Absence_workspaceId_personId_idx" ON "Absence"("workspaceId", "personId");

-- CreateIndex
CREATE INDEX "Absence_workspaceId_delegateId_idx" ON "Absence"("workspaceId", "delegateId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwoFactor" ADD CONSTRAINT "TwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPref" ADD CONSTRAINT "UserPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedToken" ADD CONSTRAINT "FeedToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAudit" ADD CONSTRAINT "StaffAudit_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanGrant" ADD CONSTRAINT "PlanGrant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_connectorId_workspaceId_fkey" FOREIGN KEY ("connectorId", "workspaceId") REFERENCES "Connector"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "NotificationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueTracker" ADD CONSTRAINT "IssueTracker_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wiki" ADD CONSTRAINT "Wiki_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_wikiId_workspaceId_fkey" FOREIGN KEY ("wikiId", "workspaceId") REFERENCES "Wiki"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAccount" ADD CONSTRAINT "VideoAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarAccount" ADD CONSTRAINT "CalendarAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_accountId_workspaceId_fkey" FOREIGN KEY ("accountId", "workspaceId") REFERENCES "CalendarAccount"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomRole" ADD CONSTRAINT "CustomRole_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceDomain" ADD CONSTRAINT "WorkspaceDomain_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoProvider" ADD CONSTRAINT "SsoProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoProvider" ADD CONSTRAINT "SsoProvider_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LdapDirectory" ADD CONSTRAINT "LdapDirectory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimToken" ADD CONSTRAINT "ScimToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_personId_workspaceId_fkey" FOREIGN KEY ("personId", "workspaceId") REFERENCES "Person"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_personId_workspaceId_fkey" FOREIGN KEY ("personId", "workspaceId") REFERENCES "Person"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInItem" ADD CONSTRAINT "CheckInItem_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInItem" ADD CONSTRAINT "CheckInItem_personId_workspaceId_fkey" FOREIGN KEY ("personId", "workspaceId") REFERENCES "Person"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInItem" ADD CONSTRAINT "CheckInItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInItem" ADD CONSTRAINT "CheckInItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInItem" ADD CONSTRAINT "CheckInItem_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "CheckInItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcebreakerAnswer" ADD CONSTRAINT "IcebreakerAnswer_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kudo" ADD CONSTRAINT "Kudo_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mood" ADD CONSTRAINT "Mood_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInComment" ADD CONSTRAINT "CheckInComment_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInItemContributor" ADD CONSTRAINT "CheckInItemContributor_itemId_workspaceId_fkey" FOREIGN KEY ("itemId", "workspaceId") REFERENCES "CheckInItem"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInItemContributor" ADD CONSTRAINT "CheckInItemContributor_personId_workspaceId_fkey" FOREIGN KEY ("personId", "workspaceId") REFERENCES "Person"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInComment" ADD CONSTRAINT "CheckInComment_itemId_workspaceId_fkey" FOREIGN KEY ("itemId", "workspaceId") REFERENCES "CheckInItem"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicVote" ADD CONSTRAINT "TopicVote_topicId_workspaceId_fkey" FOREIGN KEY ("topicId", "workspaceId") REFERENCES "Topic"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicVote" ADD CONSTRAINT "TopicVote_personId_workspaceId_fkey" FOREIGN KEY ("personId", "workspaceId") REFERENCES "Person"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_ownerId_workspaceId_fkey" FOREIGN KEY ("ownerId", "workspaceId") REFERENCES "Person"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleInstallation" ADD CONSTRAINT "ModuleInstallation_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRule" ADD CONSTRAINT "ScheduleRule_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_ruleId_workspaceId_fkey" FOREIGN KEY ("ruleId", "workspaceId") REFERENCES "ScheduleRule"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_personId_workspaceId_fkey" FOREIGN KEY ("personId", "workspaceId") REFERENCES "Person"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRule" ADD CONSTRAINT "NotificationRule_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRule" ADD CONSTRAINT "NotificationRule_connectorId_workspaceId_fkey" FOREIGN KEY ("connectorId", "workspaceId") REFERENCES "Connector"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioChunk" ADD CONSTRAINT "AudioChunk_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestLink" ADD CONSTRAINT "GuestLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestLink" ADD CONSTRAINT "GuestLink_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PokerItem" ADD CONSTRAINT "PokerItem_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PokerVote" ADD CONSTRAINT "PokerVote_itemId_workspaceId_fkey" FOREIGN KEY ("itemId", "workspaceId") REFERENCES "PokerItem"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollAnswer" ADD CONSTRAINT "PollAnswer_pollId_workspaceId_fkey" FOREIGN KEY ("pollId", "workspaceId") REFERENCES "Poll"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTheme" ADD CONSTRAINT "ProjectTheme_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "ProjectTheme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLogo" ADD CONSTRAINT "ProjectLogo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_sourceTrackerId_fkey" FOREIGN KEY ("sourceTrackerId") REFERENCES "IssueTracker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_workspaceId_fkey" FOREIGN KEY ("projectId", "workspaceId") REFERENCES "Project"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_personId_workspaceId_fkey" FOREIGN KEY ("personId", "workspaceId") REFERENCES "Person"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingProject" ADD CONSTRAINT "MeetingProject_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingProject" ADD CONSTRAINT "MeetingProject_projectId_workspaceId_fkey" FOREIGN KEY ("projectId", "workspaceId") REFERENCES "Project"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_projectId_workspaceId_fkey" FOREIGN KEY ("projectId", "workspaceId") REFERENCES "Project"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectUpdate" ADD CONSTRAINT "ProjectUpdate_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroCard" ADD CONSTRAINT "RetroCard_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroCard" ADD CONSTRAINT "RetroCard_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RetroGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroGroup" ADD CONSTRAINT "RetroGroup_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroVote" ADD CONSTRAINT "RetroVote_groupId_workspaceId_fkey" FOREIGN KEY ("groupId", "workspaceId") REFERENCES "RetroGroup"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_personId_workspaceId_fkey" FOREIGN KEY ("personId", "workspaceId") REFERENCES "Person"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "CustomRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_jobCategoryId_fkey" FOREIGN KEY ("jobCategoryId") REFERENCES "JobCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingImage" ADD CONSTRAINT "MeetingImage_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonAvatar" ADD CONSTRAINT "PersonAvatar_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCategory" ADD CONSTRAINT "JobCategory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_personId_workspaceId_fkey" FOREIGN KEY ("personId", "workspaceId") REFERENCES "Person"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceLogo" ADD CONSTRAINT "WorkspaceLogo_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_personId_workspaceId_fkey" FOREIGN KEY ("personId", "workspaceId") REFERENCES "Person"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one current session per meeting (Prisma cannot express a partial unique index)
CREATE UNIQUE INDEX "Session_one_current_per_meeting" ON "Session"("meetingId") WHERE "status" = 'current';

-- At most one project sheet being written per meeting and project
CREATE UNIQUE INDEX "ProjectUpdate_one_draft_per_meeting" ON "ProjectUpdate"("meetingId", "projectId") WHERE "sessionId" IS NULL;
