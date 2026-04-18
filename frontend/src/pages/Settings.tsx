import { useState } from 'react';
import AISettings from './AISettings';
import Keywords from './Keywords';
import WorkflowSettingsPanel from '../components/WorkflowSettingsPanel';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Brain, Hash, Workflow } from 'lucide-react';

type SettingsTab = 'ai' | 'keywords' | 'workflow';

export default function Settings() {
  const [tab, setTab] = useState<SettingsTab>('workflow');

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle>Settings</CardTitle>
          <CardDescription>Manage AI, keywords, and workflow configuration</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)}>
            <TabsList className="grid w-full max-w-[460px] grid-cols-3">
              <TabsTrigger value="ai"><Brain className="h-4 w-4 mr-1.5" />AI</TabsTrigger>
              <TabsTrigger value="keywords"><Hash className="h-4 w-4 mr-1.5" />Keywords</TabsTrigger>
              <TabsTrigger value="workflow"><Workflow className="h-4 w-4 mr-1.5" />Workflow</TabsTrigger>
            </TabsList>
            <TabsContent value="ai" className="mt-4">
              <AISettings />
            </TabsContent>
            <TabsContent value="keywords" className="mt-4">
              <Keywords />
            </TabsContent>
            <TabsContent value="workflow" className="mt-4">
              <WorkflowSettingsPanel />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
