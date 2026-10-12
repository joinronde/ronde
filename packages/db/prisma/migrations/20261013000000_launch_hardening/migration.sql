-- One subscription per workspace: the Checkout page last opened (closed when another is asked for), and how
-- often the subscription is paid
ALTER TABLE "Subscription" ADD COLUMN     "checkoutSessionId" TEXT,
ADD COLUMN     "interval" TEXT;
