ALTER TABLE "SalesOrder"
ADD CONSTRAINT "SalesOrder_cancellation_state_check"
CHECK (
  (
    "status" = 'DRAFT'
    AND "cancelledAt" IS NULL
    AND "cancelledByMembershipId" IS NULL
    AND "cancellationReason" IS NULL
  )
  OR
  (
    "status" = 'CANCELLED'
    AND "cancelledAt" IS NOT NULL
    AND "cancelledByMembershipId" IS NOT NULL
    AND "cancellationReason" IS NOT NULL
    AND length(btrim("cancellationReason")) BETWEEN 1 AND 500
  )
);

ALTER TABLE "SalesOrder"
ADD CONSTRAINT "SalesOrder_number_format_check"
CHECK ("orderNumber" ~ '^SO-[0-9]{4}-[0-9]{6}$');

ALTER TABLE "SalesOrderNumberCounter"
ADD CONSTRAINT "SalesOrderNumberCounter_next_value_check"
CHECK ("nextValue" BETWEEN 1 AND 1000001);
