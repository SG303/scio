import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FileText, GraduationCap, Clock, CheckCircle2, ArrowRight, Plus, Sparkles, Layers, Flame } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { documentsApi, testsApi, flashcardsApi } from '@/services/api'
import { formatDate, getScoreColor } from '@/lib/utils'

export default function Dashboard() {
  const { data: documents = [] } = useQuery({
    queryKey: ['documents'],
    queryFn: documentsApi.list,
  })

  const { data: tests = [] } = useQuery({
    queryKey: ['tests'],
    queryFn: testsApi.list,
  })

  const { data: flashcardStats } = useQuery({
    queryKey: ['flashcard-stats'],
    queryFn: flashcardsApi.getGlobalStats,
  })

  const recentTests = tests.slice(0, 5)
  const completedTests = tests.filter(t => t.status === 'completed')
  const averageScore = completedTests.length > 0
    ? Math.round(completedTests.reduce((acc, t) => acc + (t.score || 0), 0) / completedTests.length)
    : 0

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 via-accent/10 to-background border p-8">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium text-primary">AI-Powered Learning</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            Welcome to Scio
          </h1>
          <p className="text-muted-foreground max-w-2xl mb-6">
            Your AI Learning Hub. Upload study materials, generate practice tests, create flashcards, and organize your learning journey.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/create">
                <Plus className="h-4 w-4 mr-2" />
                Create New Test
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link to="/documents">
                <FileText className="h-4 w-4 mr-2" />
                Manage Documents
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="opacity-0 animate-fade-in stagger-1">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Documents
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{documents.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Study materials uploaded
            </p>
          </CardContent>
        </Card>

        <Card className="opacity-0 animate-fade-in stagger-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tests Taken
            </CardTitle>
            <GraduationCap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{completedTests.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Practice tests completed
            </p>
          </CardContent>
        </Card>

        <Card className="opacity-0 animate-fade-in stagger-3">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Average Score
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${getScoreColor(averageScore)}`}>
              {averageScore}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Across all tests
            </p>
          </CardContent>
        </Card>

        <Card className="opacity-0 animate-fade-in stagger-4">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              In Progress
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {tests.filter(t => t.status === 'in_progress').length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Tests to continue
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Flashcards Due Today Widget */}
      {flashcardStats && flashcardStats.total_cards > 0 && (
        <Card className="opacity-0 animate-fade-in stagger-5 border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Flame className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <CardTitle className="text-lg">Flashcards Due Today</CardTitle>
                <CardDescription>Cards ready for review</CardDescription>
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-amber-500">{flashcardStats.due_today}</div>
              <div className="text-xs text-muted-foreground">cards</div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 text-sm mb-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                <span className="text-muted-foreground">{flashcardStats.new_available} New</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                <span className="text-muted-foreground">{flashcardStats.due_reviews} Review</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-muted-foreground"></div>
                <span className="text-muted-foreground">{flashcardStats.total_decks} Decks</span>
              </div>
            </div>
            <div className="flex gap-3">
              <Button className="flex-1" asChild>
                <Link to="/flashcards">
                  <Layers className="h-4 w-4 mr-2" />
                  View Decks
                </Link>
              </Button>
              {flashcardStats.due_today > 0 && (
                <Button variant="outline" asChild>
                  <Link to="/flashcards">
                    <Sparkles className="h-4 w-4 mr-2" />
                    Start Studying
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Tests */}
      <Card className="opacity-0 animate-fade-in stagger-5">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recent Tests</CardTitle>
              <CardDescription>Your latest practice sessions</CardDescription>
            </div>
            {tests.length > 5 && (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/tests">
                  View all
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {recentTests.length === 0 ? (
            <div className="text-center py-12">
              <GraduationCap className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No tests yet</h3>
              <p className="text-muted-foreground mb-4">
                Upload some documents and create your first practice test
              </p>
              <Button asChild>
                <Link to="/create">Create Test</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {recentTests.map((test) => (
                <Link
                  key={test.id}
                  to={test.status === 'completed' ? `/results/${test.id}` : `/test/${test.id}`}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card/50 hover:bg-card transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                      test.status === 'completed' ? 'bg-success/10' : 
                      test.status === 'in_progress' ? 'bg-primary/10' : 'bg-muted'
                    }`}>
                      {test.status === 'completed' ? (
                        <CheckCircle2 className="h-5 w-5 text-success" />
                      ) : test.status === 'in_progress' ? (
                        <Clock className="h-5 w-5 text-primary" />
                      ) : (
                        <GraduationCap className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <h4 className="font-medium">{test.config_title || `Test #${test.id}`}</h4>
                      <p className="text-sm text-muted-foreground">
                        {test.total_questions} questions • {formatDate(test.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {test.status === 'completed' && test.score !== null && (
                      <span className={`text-lg font-bold ${getScoreColor(test.score)}`}>
                        {test.score}%
                      </span>
                    )}
                    {test.status === 'in_progress' && (
                      <span className="text-sm text-primary">Continue →</span>
                    )}
                    {test.status === 'generated' && (
                      <span className="text-sm text-muted-foreground">Start →</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

