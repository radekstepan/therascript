// packages/ui/src/components/Analysis/MapReduceVisualization.tsx
import React, { useRef, useEffect, useState } from 'react';
import { motion, useAnimation } from 'framer-motion';
import { Box, Flex, Text, Tooltip, Spinner } from '@radix-ui/themes';
import {
  CheckCircledIcon,
  CrossCircledIcon,
  LightningBoltIcon,
  InfoCircledIcon,
} from '@radix-ui/react-icons';
import type {
  AnalysisJob,
  IntermediateSummaryWithSessionName,
} from '../../types';

interface MapReduceVisualizationProps {
  job: AnalysisJob;
  isProcessing: boolean;
}

interface NodeState {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
}

const StrategyNode: React.FC<{
  status: NodeState['status'];
}> = ({ status }) => {
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{
        scale: 1,
        opacity: 1,
        backgroundColor:
          status === 'completed'
            ? 'var(--green-a8)'
            : status === 'processing'
              ? 'var(--blue-a8)'
              : status === 'skipped'
                ? 'var(--gray-a3)'
                : 'var(--gray-a3)',
        borderColor:
          status === 'processing'
            ? 'var(--blue-a11)'
            : status === 'completed'
              ? 'var(--green-a11)'
              : 'var(--gray-a6)',
      }}
      transition={{ duration: 0.3 }}
      style={{
        width: '80px',
        height: '80px',
        borderRadius: '50%',
        border: '2px solid',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <Flex direction="column" align="center" gap="1">
        {status === 'processing' && <Spinner size="2" />}
        {status === 'completed' && (
          <CheckCircledIcon
            width={20}
            height={20}
            style={{ color: 'var(--gray-12)' }}
          />
        )}
        {status === 'skipped' && (
          <InfoCircledIcon
            width={20}
            height={20}
            style={{ color: 'var(--gray-10)' }}
          />
        )}
        {status === 'pending' && (
          <InfoCircledIcon
            width={20}
            height={20}
            style={{ color: 'var(--gray-9)' }}
          />
        )}
        <Text
          size="1"
          style={{
            color: status === 'completed' ? 'var(--gray-12)' : 'var(--gray-11)',
          }}
        >
          Strategy
        </Text>
      </Flex>
      {status === 'processing' && (
        <motion.div
          style={{
            position: 'absolute',
            inset: -4,
            borderRadius: '50%',
            border: '2px solid var(--blue-a8)',
          }}
          animate={{
            scale: [1, 1.2, 1],
            opacity: [1, 0, 1],
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      )}
    </motion.div>
  );
};

const SessionNode: React.FC<{
  summary: IntermediateSummaryWithSessionName;
  status: NodeState['status'];
  onClick?: () => void;
}> = ({ summary, status, onClick }) => {
  return (
    <Tooltip content={summary.sessionName}>
      <motion.div
        onClick={onClick}
        whileHover={{ scale: onClick ? 1.05 : 1 }}
        whileTap={onClick ? { scale: 0.95 } : undefined}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: 1,
          opacity: 1,
          backgroundColor:
            status === 'completed'
              ? 'var(--green-a8)'
              : status === 'processing'
                ? 'var(--blue-a8)'
                : status === 'failed'
                  ? 'var(--red-a8)'
                  : 'transparent',
          borderColor:
            status === 'processing'
              ? 'var(--blue-a11)'
              : status === 'completed'
                ? 'var(--green-a11)'
                : status === 'failed'
                  ? 'var(--red-a11)'
                  : 'var(--gray-a5)',
        }}
        transition={{ duration: 0.3 }}
        style={{
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          border: '2px solid',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          cursor: onClick ? 'pointer' : 'default',
        }}
      >
        <Flex direction="column" align="center">
          {status === 'processing' && <Spinner size="2" />}
          {status === 'completed' && (
            <CheckCircledIcon
              width={18}
              height={18}
              style={{ color: 'var(--gray-12)' }}
            />
          )}
          {status === 'failed' && (
            <CrossCircledIcon
              width={18}
              height={18}
              style={{ color: 'var(--gray-12)' }}
            />
          )}
          {status === 'pending' && (
            <Text size="1" style={{ color: 'var(--gray-8)' }} weight="medium">
              {summary.id % 100}
            </Text>
          )}
        </Flex>
        {status === 'processing' && (
          <motion.div
            style={{
              position: 'absolute',
              inset: -3,
              borderRadius: '50%',
              border: '2px solid var(--blue-a8)',
            }}
            animate={{
              scale: [1, 1.2, 1],
              opacity: [1, 0, 1],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        )}
      </motion.div>
    </Tooltip>
  );
};

const ReduceNode: React.FC<{
  status: NodeState['status'];
}> = ({ status }) => {
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{
        scale: 1,
        opacity: 1,
        backgroundColor:
          status === 'completed'
            ? 'var(--green-a8)'
            : status === 'processing'
              ? 'var(--blue-a8)'
              : 'var(--gray-a3)',
        borderColor:
          status === 'processing'
            ? 'var(--blue-a11)'
            : status === 'completed'
              ? 'var(--green-a11)'
              : 'var(--gray-a6)',
      }}
      transition={{ duration: 0.3 }}
      style={{
        width: '100px',
        height: '100px',
        borderRadius: '50%',
        border: '3px solid',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <Flex direction="column" align="center" gap="1">
        {status === 'processing' && (
          <>
            <Spinner size="3" />
            <Text size="1" style={{ color: 'var(--gray-12)' }}>
              Reducing...
            </Text>
          </>
        )}
        {status === 'completed' && (
          <>
            <CheckCircledIcon
              width={28}
              height={28}
              style={{ color: 'var(--gray-12)' }}
            />
            <Text size="1" style={{ color: 'var(--gray-12)' }}>
              Done
            </Text>
          </>
        )}
        {status === 'pending' && (
          <>
            <LightningBoltIcon
              width={24}
              height={24}
              style={{ color: 'var(--gray-9)' }}
            />
            <Text size="1" style={{ color: 'var(--gray-11)' }}>
              Reduce
            </Text>
          </>
        )}
      </Flex>
      {status === 'processing' && (
        <motion.div
          style={{
            position: 'absolute',
            inset: -5,
            borderRadius: '50%',
            border: '3px solid var(--blue-a8)',
          }}
          animate={{
            scale: [1, 1.25, 1],
            opacity: [1, 0, 1],
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      )}
    </motion.div>
  );
};

const AnimatedConnector: React.FC<{
  isComplete: boolean;
  isAnimating: boolean;
}> = ({ isComplete, isAnimating }) => {
  const controls = useAnimation();
  const [showParticle, setShowParticle] = useState(false);

  useEffect(() => {
    if (isComplete) {
      controls.start({
        opacity: 1,
        transition: { duration: 0.5 },
      });
      setShowParticle(true);
    } else {
      controls.start({
        opacity: 0.3,
        transition: { duration: 0.3 },
      });
      setShowParticle(false);
    }
  }, [isComplete, controls]);

  return (
    <Box
      style={{
        position: 'relative',
        flex: 1,
        height: '2px',
        background: 'var(--gray-a5)',
        margin: '0 10px',
      }}
    >
      <motion.div
        initial={{ opacity: 0.3 }}
        animate={controls}
        style={{
          position: 'absolute',
          inset: 0,
          background: isComplete ? 'var(--green-a8)' : 'var(--gray-a5)',
          borderRadius: '1px',
        }}
      />
      {isComplete && showParticle && isAnimating && (
        <motion.div
          initial={{ left: '0%', opacity: 0 }}
          animate={{
            left: ['0%', '100%'],
            opacity: [1, 1, 0],
          }}
          transition={{
            duration: 1.5,
            ease: 'easeInOut',
            repeat: Infinity,
          }}
          style={{
            position: 'absolute',
            top: '-4px',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: 'var(--blue-a11)',
            boxShadow: '0 0 10px var(--blue-a9)',
          }}
        />
      )}
    </Box>
  );
};

export function MapReduceVisualization({
  job,
  isProcessing,
}: MapReduceVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const strategyStatus: NodeState['status'] =
    job.status === 'generating_strategy'
      ? 'processing'
      : job.status === 'pending'
        ? 'pending'
        : job.strategy !== null
          ? 'completed'
          : 'skipped';

  const mapStatuses: NodeState['status'][] =
    job.summaries?.map((s) =>
      s.status === 'processing'
        ? 'processing'
        : s.status === 'completed'
          ? 'completed'
          : s.status === 'failed'
            ? 'failed'
            : 'pending'
    ) || [];

  const reduceStatus: NodeState['status'] =
    job.status === 'reducing'
      ? 'processing'
      : job.status === 'completed'
        ? 'completed'
        : job.status === 'failed'
          ? 'failed'
          : 'pending';

  const allSessionsCompleted = mapStatuses.every(
    (s) => s === 'completed' || s === 'failed'
  );
  const isReducePhase = job.status === 'reducing' || job.status === 'completed';
  const showDataFlowAnimation =
    allSessionsCompleted && isProcessing && !isReducePhase;

  const handleSessionClick = (summaryId: number) => {
    const element = document.getElementById(`summary-${summaryId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('highlight-flash');
      setTimeout(() => {
        element.classList.remove('highlight-flash');
      }, 2000);
    }
  };

  return (
    <Box
      ref={containerRef}
      p="4"
      style={{
        background: 'var(--gray-a2)',
        borderRadius: 'var(--radius-3)',
        border: '1px solid var(--gray-a5)',
        overflow: 'hidden',
      }}
    >
      <Flex direction="column" gap="4" align="center">
        {/* Strategy Phase */}
        {job.strategy !== null && (
          <Flex align="center" gap="3">
            <StrategyNode status={strategyStatus} />
            {strategyStatus !== 'pending' && strategyStatus !== 'skipped' && (
              <AnimatedConnector
                isComplete={strategyStatus === 'completed'}
                isAnimating={strategyStatus === 'processing'}
              />
            )}
          </Flex>
        )}

        {/* Map Phase */}
        <Flex direction="column" gap="3" width="100%">
          <Text size="2" weight="medium" color="gray">
            Map Phase ({job.summaries?.length || 0} sessions)
          </Text>
          <Flex wrap="wrap" gap="4" justify="center">
            {job.summaries?.map((summary, index) => (
              <SessionNode
                key={summary.id}
                summary={summary}
                status={mapStatuses[index] || 'pending'}
                onClick={() =>
                  mapStatuses[index] === 'completed' &&
                  handleSessionClick(summary.id)
                }
              />
            ))}
          </Flex>
        </Flex>

        {/* Connectors to Reduce */}
        {allSessionsCompleted && (
          <AnimatedConnector
            isComplete={allSessionsCompleted}
            isAnimating={showDataFlowAnimation}
          />
        )}

        {/* Reduce Phase */}
        <Flex align="center" justify="center" gap="3" width="100%">
          <ReduceNode status={reduceStatus} />
        </Flex>

        {/* Status Text */}
        {isProcessing && (
          <Text size="2" color="blue">
            {job.status === 'generating_strategy' &&
              'Generating analysis strategy...'}
            {job.status === 'mapping' && 'Processing individual sessions...'}
            {job.status === 'reducing' && 'Synthesizing final answer...'}
          </Text>
        )}
      </Flex>
    </Box>
  );
}
